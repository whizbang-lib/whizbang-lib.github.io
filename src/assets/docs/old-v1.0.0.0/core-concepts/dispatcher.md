---
title: Dispatcher & Policies
category: Core Concepts
order: 5
tags: dispatcher, policies, configuration, coordination
description: The Dispatcher coordinates all message flow between receptors, perspectives, and lenses, with policies controlling behavior and execution strategies
---

# Dispatcher & Policies

## Overview

The **Dispatcher** is the central nervous system of Whizbang. It coordinates message flow between receptors, perspectives, and lenses, while **Policies** define how components behave and execute. Together, they provide a unified runtime that scales from event-driven development to complex event-sourced systems.

## What is the Dispatcher?

The Dispatcher:
- **Routes** commands to the appropriate receptors
- **Publishes** events from receptors to interested perspectives
- **Executes** queries against lenses
- **Coordinates** saga workflows
- **Applies** policies to control behavior
- **Manages** the execution pipeline

Think of the dispatcher as an intelligent router that understands your domain and ensures messages reach the right destinations.

## Core Dispatcher Responsibilities

### 1. Message Routing

```csharp{
title: "Message Routing"
description: "How the dispatcher routes different message types"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Dispatcher", "Routing", "Messages"]
filename: "MessageRouting.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
public class OrderDispatcherExample {
    private readonly IDispatcher dispatcher;

    public async Task DemonstrateRouting() {
        // Commands routed to owning receptors
        var orderEvent = await dispatcher.Send(new CreateOrder(...));
        
        // Events published to interested perspectives
        // OrderPerspective, AnalyticsPerspective, etc. all receive the event
        
        // Queries executed against lenses
        var orderLens = dispatcher.GetLens<IOrderLens>();
        var orders = orderLens.ViewByCustomer(customerId);
    }
}
```

### 2. Return Type Interpretation

The dispatcher uses return types to determine what happens next:

```csharp{
title: "Return Type Semantics"
description: "How return types control dispatcher behavior"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Dispatcher", "Return Types", "Semantics"]
filename: "ReturnTypeSemantics.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
public class ReturnTypeExamples {
    // Single event → Published to perspectives
    public OrderCreated Receive(CreateOrder cmd) {
        return new OrderCreated(...);
    }
    
    // Multiple events → All published in sequence
    public (OrderCreated, EmailQueued, InventoryReserved) Receive(PlaceOrder cmd) {
        return (
            new OrderCreated(...),
            new EmailQueued(...),
            new InventoryReserved(...)
        );
    }
    
    // Result type → Success/failure handling
    public Result<PaymentProcessed> Receive(ProcessPayment cmd) {
        if (cmd.Amount <= 0) {
            return Result.Failure<PaymentProcessed>("Invalid amount");
        }
        return Result.Success(new PaymentProcessed(...));
    }
    
    // Void → Fire-and-forget
    public void Receive(LogActivity cmd) {
        Console.WriteLine(cmd.Message);
    }
}
```

### 3. Pipeline Coordination

```csharp{
title: "Execution Pipeline"
description: "The dispatcher coordinates the entire execution pipeline"
framework: "NET8"
category: "Core Concepts"
difficulty: "ADVANCED"
tags: ["Dispatcher", "Pipeline", "Coordination"]
filename: "ExecutionPipeline.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
// Simplified view of dispatcher pipeline
public class DispatcherPipeline {
    public async Task<TResult> Execute<TResult>(object message) {
        // 1. Apply pre-execution policies
        await ApplyPolicies(message, PolicyStage.PreExecution);
        
        // 2. Route to appropriate receptor
        var receptor = ResolveReceptor(message);
        
        // 3. Execute receptor with lens injection
        var result = await ExecuteReceptor(receptor, message);
        
        // 4. Handle return value based on type
        await ProcessReturnValue(result);
        
        // 5. Apply post-execution policies
        await ApplyPolicies(message, PolicyStage.PostExecution);
        
        return (TResult)result;
    }
}
```

## Policies

**Policies** define how the dispatcher and components behave. They control execution strategies, error handling, performance characteristics, and more.

### Policy Types

#### 1. Execution Policies

Control how and when receptors execute:

```csharp{
title: "Execution Policies"
description: "Policies that control receptor execution behavior"
framework: "NET8"
category: "Policies"
difficulty: "INTERMEDIATE"
tags: ["Policies", "Execution", "Configuration"]
filename: "ExecutionPolicies.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
services.AddWhizbang(dispatcher => {
    // Event-driven execution policy
    dispatcher.ForReceptor<OrderReceptor>()
        .UsePolicy(new EventDrivenPolicy {
            ExecutionMode = ExecutionMode.Synchronous,
            MaxConcurrency = 1,
            Timeout = TimeSpan.FromSeconds(30)
        });
    
    // Event-sourced execution policy
    dispatcher.ForReceptor<PaymentReceptor>()
        .UsePolicy(new EventSourcedPolicy {
            SnapshotFrequency = 100,
            CacheDuration = TimeSpan.FromMinutes(5),
            ReplayOptimization = true
        });
});
```

#### 2. Resilience Policies

Handle failures and ensure reliability:

```csharp{
title: "Resilience Policies"
description: "Policies for handling failures and ensuring reliability"
framework: "NET8"
category: "Policies"
difficulty: "INTERMEDIATE"
tags: ["Policies", "Resilience", "Error Handling"]
filename: "ResiliencePolicies.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
dispatcher.ForReceptor<PaymentReceptor>()
    .UsePolicy(new ResiliencePolicy {
        RetryCount = 3,
        RetryBackoff = BackoffStrategy.Exponential,
        CircuitBreakerThreshold = 5,
        CircuitBreakerDuration = TimeSpan.FromMinutes(1),
        FallbackAction = FallbackAction.DeadLetter
    });

// Perspective resilience
dispatcher.Perspectives
    .UsePolicy(new PerspectiveResiliencePolicy {
        RetryCount = 5,
        RetryBackoff = BackoffStrategy.Linear,
        DeadLetterAfter = 10,
        BatchSize = 50
    });
```

#### 3. Performance Policies

Optimize for throughput and latency:

```csharp{
title: "Performance Policies"
description: "Policies for optimizing performance characteristics"
framework: "NET8"
category: "Policies"
difficulty: "ADVANCED"
tags: ["Policies", "Performance", "Optimization"]
filename: "PerformancePolicies.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
dispatcher.ForReceptor<HighVolumeReceptor>()
    .UsePolicy(new PerformancePolicy {
        // Enable object pooling
        UseObjectPooling = true,
        PoolSize = 100,
        
        // Batching configuration
        EnableBatching = true,
        BatchSize = 50,
        BatchTimeout = TimeSpan.FromMilliseconds(100),
        
        // Caching configuration
        EnableCaching = true,
        CacheSize = 1000,
        CacheTTL = TimeSpan.FromMinutes(5)
    });
```

#### 4. Security Policies

Control access and enforce authorization:

```csharp{
title: "Security Policies"
description: "Policies for access control and authorization"
framework: "NET8"
category: "Policies"
difficulty: "INTERMEDIATE"
tags: ["Policies", "Security", "Authorization"]
filename: "SecurityPolicies.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
dispatcher.ForReceptor<SensitiveReceptor>()
    .UsePolicy(new SecurityPolicy {
        RequireAuthentication = true,
        RequiredRoles = new[] { "Admin", "Manager" },
        RequiredPermissions = new[] { "orders:create", "payments:process" },
        AuditLevel = AuditLevel.Full,
        EncryptSensitiveData = true
    });

// Multi-tenant security
dispatcher.UseTenantIsolation(tenant => {
    tenant.IsolateEventStreams = true;
    tenant.IsolatePerspectives = true;
    tenant.RequireTenantScope = true;
});
```

## Policy Configuration Patterns

### 1. Global Policies

Apply to all components:

```csharp{
title: "Global Policy Configuration"
description: "Applying policies globally across all components"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Policies", "Global", "Configuration"]
filename: "GlobalPolicies.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
services.AddWhizbang(dispatcher => {
    // Global logging policy
    dispatcher.UseGlobalPolicy(new LoggingPolicy {
        LogLevel = LogLevel.Information,
        IncludePerformanceMetrics = true,
        IncludePayload = false // For security
    });
    
    // Global resilience policy
    dispatcher.UseGlobalPolicy(new GlobalResiliencePolicy {
        DefaultRetryCount = 3,
        DefaultTimeout = TimeSpan.FromSeconds(30),
        EnableCircuitBreaker = true
    });
});
```

### 2. Component-Specific Policies

Apply to specific receptors, perspectives, or lenses:

```csharp{
title: "Component-Specific Policies"
description: "Applying policies to specific components"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Policies", "Component-Specific", "Configuration"]
filename: "ComponentPolicies.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
services.AddWhizbang(dispatcher => {
    // Receptor-specific policies
    dispatcher.ForReceptor<OrderReceptor>()
        .UseEventSourcedPolicy()
        .WithSnapshotting(frequency: 50)
        .WithCaching(duration: TimeSpan.FromMinutes(10));
    
    // Perspective-specific policies
    dispatcher.ForPerspective<AnalyticsPerspective>()
        .UseAsyncExecution()
        .WithBatching(size: 100)
        .WithLowPriority();
    
    // Lens-specific policies
    dispatcher.ForLens<IOrderLens>()
        .UseCaching(duration: TimeSpan.FromMinutes(5))
        .WithReadReplica();
});
```

### 3. Conditional Policies

Apply policies based on runtime conditions:

```csharp{
title: "Conditional Policy Application"
description: "Applying policies based on runtime conditions"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Policies", "Conditional", "Runtime"]
filename: "ConditionalPolicies.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
dispatcher.UseConditionalPolicy(context => {
    // Apply different policies based on message type
    if (context.Message is HighPriorityCommand) {
        return new HighPriorityPolicy {
            MaxLatency = TimeSpan.FromMilliseconds(100),
            PreferredThreads = 4
        };
    }
    
    // Apply policies based on tenant
    if (context.TenantId == "enterprise-customer") {
        return new EnterprisePolicy {
            SLA = TimeSpan.FromSeconds(1),
            BackupReplicas = 3
        };
    }
    
    return new StandardPolicy();
});
```

## Policy Composition

Policies can be composed and layered:

```csharp{
title: "Policy Composition"
description: "Composing multiple policies for complex behavior"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Policies", "Composition", "Layering"]
filename: "PolicyComposition.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
dispatcher.ForReceptor<CriticalReceptor>()
    .UsePolicy(new SecurityPolicy { RequireAuthentication = true })
    .UsePolicy(new PerformancePolicy { EnableCaching = true })
    .UsePolicy(new ResiliencePolicy { RetryCount = 5 })
    .UsePolicy(new AuditPolicy { LogLevel = AuditLevel.Full })
    .UsePolicy(new CompliancePolicy { EncryptData = true });

// Policies are applied in order, with later policies able to override earlier ones
```

## Dispatcher Modes

The dispatcher supports different execution modes:

### 1. Event-Driven Mode

```csharp{
title: "Event-Driven Mode Configuration"
description: "Configuring the dispatcher for event-driven execution"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Dispatcher", "Event-Driven", "Configuration"]
filename: "EventDrivenMode.cs"
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
services.AddWhizbang(dispatcher => {
    // Event-driven mode with stateless receptors
    dispatcher.UseEventDrivenMode(options => {
        options.DefaultExecutionMode = ExecutionMode.Synchronous;
        options.EnablePerspectivePersistence = true;
        options.MaxConcurrentReceptors = Environment.ProcessorCount;
    });
    
    // Perspective configuration
    dispatcher.Perspectives
        .UsePostgreSQL(connectionString)
        .WithBatching(size: 50)
        .WithRetry(count: 3);
});
```

### 2. Event-Sourced Mode

```csharp{
title: "Event-Sourced Mode Configuration"
description: "Configuring the dispatcher for event sourcing"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Dispatcher", "Event-Sourced", "Configuration"]
filename: "EventSourcedMode.cs"
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
services.AddWhizbang(dispatcher => {
    // Event-sourced mode with stateful receptors
    dispatcher.UseEventSourcing(es => {
        es.UseLedger(ledger => {
            ledger.UsePostgreSQL(connectionString);
            ledger.EnableSnapshots(frequency: 100);
            ledger.ConfigurePartitioning(partitions: 8);
        });
        
        es.EnableTimeTravel();
        es.EnableReplay();
    });
    
    // Receptor policies for event sourcing
    dispatcher.UseGlobalPolicy(new EventSourcedPolicy {
        DefaultSnapshotFrequency = 50,
        DefaultCacheDuration = TimeSpan.FromMinutes(5)
    });
});
```

### 3. Distributed Mode

```csharp{
title: "Distributed Mode Configuration"
description: "Configuring the dispatcher for distributed execution"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Dispatcher", "Distributed", "Configuration"]
filename: "DistributedMode.cs"
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
services.AddWhizbang(dispatcher => {
    // Distributed mode with relays
    dispatcher.UseRelays(relays => {
        relays.UseKafka(kafka => {
            kafka.BootstrapServers = "localhost:9092";
            kafka.EnableIdempotence = true;
            kafka.Partitions = 12;
        });
    });
    
    // Service ownership configuration
    dispatcher.ConfigureDomain("Orders", domain => {
        domain.OwnsReceptor<OrderReceptor>();
        domain.PublishesEvents<OrderCreated, OrderShipped>();
        domain.SubscribesToEvents<PaymentProcessed, InventoryReserved>();
    });
});
```

## Policy Best Practices

### Do's

✅ **Start with sensible defaults**
```csharp{
title: "Sensible Defaults Pattern"
description: "Start with framework defaults and override only what's needed"
framework: "NET8"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["Policies", "Configuration", "Best Practices"]
filename: "DefaultPolicies.cs"
usingStatements: ["Whizbang"]
}
// Use framework defaults first
dispatcher.UseDefaults();

// Override only what you need
dispatcher.ForReceptor<SpecialReceptor>()
    .UseCustomPolicy(mySpecialPolicy);
```

✅ **Layer policies logically**
```csharp{
title: "Policy Layering Pattern"
description: "Layer policies from general to specific"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Policies", "Layering", "Best Practices"]
filename: "PolicyLayering.cs"
usingStatements: ["Whizbang"]
}
// Layer from general to specific
dispatcher
    .UseGlobalPolicy(globalSecurity)
    .ForReceptor<PaymentReceptor>()
    .UsePolicy(paymentSpecificSecurity);
```

✅ **Test policy behavior**
```csharp{
title: "Policy Testing Pattern"
description: "Test that policies are applied correctly"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Testing", "Policies", "Verification"]
filename: "PolicyTests.cs"
usingStatements: ["Xunit", "Whizbang"]
}
[Fact]
public async Task PolicyAppliesCorrectly() {
    var dispatcher = CreateTestDispatcher()
        .WithPolicy(testPolicy);
    
    // Verify policy behavior
    var result = await dispatcher.Send(testCommand);
    Assert.True(testPolicy.WasApplied);
}
```

### Don'ts

❌ **Don't over-configure**
```csharp{
title: "Anti-Pattern: Over-Configuration"
description: "Don't add too many policies to simple components"
framework: "NET8"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["Anti-Pattern", "Over-Configuration", "Policies"]
filename: "OverConfiguration.cs"
usingStatements: ["Whizbang"]
}
// BAD - Too many specific policies
dispatcher.ForReceptor<SimpleReceptor>()
    .UsePolicy(policy1)
    .UsePolicy(policy2)
    .UsePolicy(policy3)
    .UsePolicy(policy4); // Overkill for simple receptors
```

❌ **Don't ignore policy conflicts**
```csharp{
title: "Anti-Pattern: Policy Conflicts"
description: "Don't create conflicting policy configurations"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Anti-Pattern", "Policy Conflicts", "Configuration"]
filename: "PolicyConflicts.cs"
usingStatements: ["Whizbang", "System"]
}
// BAD - Conflicting timeout policies
dispatcher
    .UseGlobalPolicy(new TimeoutPolicy { Timeout = TimeSpan.FromSeconds(30) })
    .ForReceptor<MyReceptor>()
    .UsePolicy(new TimeoutPolicy { Timeout = TimeSpan.FromSeconds(5) }); // Which one wins?
```

## Summary

The Dispatcher and Policies system provides:

- **Unified coordination** of all message flow
- **Flexible execution strategies** through policies
- **Progressive enhancement** from simple to complex
- **Fine-grained control** over behavior and performance
- **Composition** of multiple policies for complex scenarios

The dispatcher ensures that receptors, perspectives, and lenses work together seamlessly, while policies give you precise control over how they behave.

## Next Steps

- Explore **[Receptors](/docs/core-concepts/receptors)** - Decision-making components
- Learn about **[Perspectives](/docs/core-concepts/perspectives)** - Event handlers and read models
- See **[Lenses](/docs/core-concepts/lenses)** - Read-only query interfaces
- Review **[Event-Driven Architecture](/docs/architecture-design/event-driven-architecture)** - The bigger picture