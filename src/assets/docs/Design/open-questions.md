---
title: Open Design Questions - RESOLVED
category: Architecture & Design
order: 3
tags: architecture, design-decisions, resolved, specifications
---

# Open Design Questions - RESOLVED ✅

**Status**: All critical and important design questions have been resolved and documented in detailed specification documents.

This document previously captured open questions and architectural decisions for Whizbang. **All questions have now been resolved** and documented in comprehensive specifications.

## 🔴 Critical Decisions - ALL RESOLVED ✅

**All critical decisions have been resolved and documented**. See the detailed specifications below:

### 1. Handler Discovery Mechanism ✅ **RESOLVED**
**Decision**: Hybrid approach (Source Generators + Explicit Registration)
- **Detailed Specification**: [Domain Ownership](./domain-ownership.md)

### 2. Handler Method Signature Conventions ✅ **RESOLVED**
**Decision**: Convention-based with Source Generator support
- **Detailed Specification**: [Domain Ownership](./domain-ownership.md)

### 3. Event Store Schema Design ✅ **RESOLVED**
**Decision**: Hybrid approach (Separate Events and Projections with JSONB)
- **Detailed Specification**: [Event Store & Projections](./event-store-projections.md)

### 4. Optimistic Concurrency Strategy ✅ **RESOLVED**
**Decision**: Support all strategies (Expected Version, Timestamp-Based, Automatic Retry)
- **Detailed Specification**: [Concurrency Control](./concurrency-control.md)

### 5. Domain Ownership Declaration ✅ **RESOLVED**
**Decision**: Configurable precedence order (Namespace → Attributes → Configuration)
- **Detailed Specification**: [Domain Ownership](./domain-ownership.md)

---

## 🟡 Important Decisions - ALL RESOLVED ✅

### 6. Projection Checkpoint Storage ✅ **RESOLVED**
**Decision**: Support both Same Database (default) and Separate Metadata Store
- **Detailed Specification**: [Projection Management](./projection-management.md)

### 7. Snapshot Strategy ✅ **RESOLVED**
**Decision**: Support all strategies (Automatic, Manual, None with Automatic as default)
- **Detailed Specification**: [Event Store & Projections](./event-store-projections.md)

### 8. Projection Backfilling API ✅ **RESOLVED**
**Decision**: Support both Declarative and Imperative with System Events
- **Detailed Specification**: [Projection Management](./projection-management.md)

### 9. Saga State Persistence ✅ **RESOLVED**
**Decision**: Event-Sourced Sagas as primary pattern
- **Detailed Specification**: [Event Store & Projections](./event-store-projections.md)

---

## 🟢 Future Considerations - DOCUMENTED ✅

All future considerations have been documented in the new specification files:

### 10. Multi-Tenancy Support ✅ **DOCUMENTED**
**Comprehensive support for single/multiple databases and tenant isolation**
- **Detailed Specification**: [Multi-Tenancy](./multi-tenancy.md)

### 11. Schema Evolution & Event Versioning ✅ **DOCUMENTED**
**JSONB-based evolution with upcasting and schema registry support**
- **Detailed Specification**: [Schema Evolution](./schema-evolution.md)

### 12. Blue/Green Projection Deployments ✅ **DOCUMENTED**
**Driver-level blue/green implementation with atomic table swapping**
- **Detailed Specification**: [Schema Evolution](./schema-evolution.md)

### 13. Cross-Aggregate Transactions ✅ **DOCUMENTED**
**Unit of Work pattern with saga fallback for complex operations**
- **Detailed Specification**: [Advanced Features](./advanced-features.md)

### 14. Outbox/Inbox Table Schema ✅ **DOCUMENTED**
**Comprehensive outbox/inbox pattern implementation**
- **Detailed Specification**: [Event Store & Projections](./event-store-projections.md)

### 15. Distributed Tracing Context ✅ **DOCUMENTED**
**W3C trace context headers with OpenTelemetry integration**
- **Detailed Specification**: [Advanced Features](./advanced-features.md)

### 16. Performance Budgets & SLOs ✅ **DOCUMENTED**
**Attribute and programmatic performance budgets with OpenTelemetry**
- **Detailed Specification**: [Advanced Features](./advanced-features.md)

### 17. Kubernetes Operator Features ✅ **DOCUMENTED**
**Auto-scaling, partition-aware placement, and blue/green deployments**
- **Detailed Specification**: [Advanced Features](./advanced-features.md)

### 18. Debugging & Development Tools ✅ **DOCUMENTED**
**OpenTelemetry journey visualization, replay, and state inspection**
- **Detailed Specification**: [Advanced Features](./advanced-features.md)

---

## Implementation Status

**All architectural questions have been resolved** and documented in comprehensive specification files. The library design is now ready for implementation.

### Next Steps

1. **Review specifications** - Study the detailed documentation for each area
2. **Create ADRs** - Document key decisions in Architecture Decision Records
3. **Begin implementation** - Start building based on the specifications
4. **Validate with prototypes** - Build proof-of-concepts to validate designs

### For Contributors

All major architectural decisions have been made. Contributors should:
1. **Read the specifications** before starting work
2. **Follow the documented patterns** in implementation
3. **Propose changes** via GitHub Discussions if specifications need updates

### For Maintainers

Focus on:
1. **Implementation planning** - Break down specifications into development tasks
2. **Prototype validation** - Build key components to validate architectural decisions
3. **Documentation updates** - Keep specifications current as implementation progresses

---

## Complete Specification Suite

### Core Architecture
- [**Event Store & Projections**](./event-store-projections.md) - Storage architecture and JSONB projections
- [**Domain Ownership**](./domain-ownership.md) - Handler discovery and ownership policies
- [**Concurrency Control**](./concurrency-control.md) - Multiple concurrency strategies

### Advanced Features
- [**Projection Management**](./projection-management.md) - Checkpoints, snapshots, and backfilling
- [**Multi-Tenancy**](./multi-tenancy.md) - Comprehensive tenant isolation strategies
- [**Schema Evolution**](./schema-evolution.md) - JSONB evolution and versioning
- [**Policy Engine**](./policy-engine.md) - Universal configuration scoping mechanism
- [**Flags & Tags System**](./flags-tags-system.md) - Cross-service context propagation
- [**Advanced Features**](./advanced-features.md) - Cross-aggregate transactions, K8s operators, debugging

### Implementation & Tooling
- [**Source Generation & IDE Integration**](./source-generation-ide.md) - Incremental generation and navigation service
- [**Testing & Development Tools**](./testing-development-tools.md) - Comprehensive testing framework and CLI tools
- [**Observability & Metrics**](./observability-metrics.md) - Policy-driven monitoring and OpenTelemetry
- [**Deployment & Operations**](./deployment-operations.md) - Production deployment and operational patterns

### Foundation Documents
- [**Philosophy**](../architecture-design/philosophy.md) - Core principles and design philosophy
- [**Architecture**](../architecture-design/architecture.md) - Overall system architecture

---

**Ready to implement!** All questions resolved, specifications complete, design decisions documented.

---

## 🆕 New Questions Emerging from Implementation Planning

As we dive deeper into the specifications, new architectural questions have emerged that need resolution:

## 🔴 Critical Implementation Questions

### 19. Source Generator Architecture ✅ **RESOLVED**

**Decision**: Single incremental generator with pipeline architecture

**Key Requirements**:
- **Incremental generation** - Only regenerate what changed
- **IDE integration** - Analyzer errors/fixes + navigation service
- **Multi-project support** - Aggregate generated code across project dependencies
- **Debug transparency** - No "magic", clear generated code + metadata
- **Build observability** - Detailed logging and timing for optimization

**Implementation Approach**:
```csharp
[Generator]
public class WhizbangSourceGenerator : IIncrementalGenerator {
    public void Initialize(IncrementalGeneratorInitializationContext context) {
        // Pipeline stages with timing/logging
        var handlersPipeline = context.SyntaxProvider.CreateSyntaxProvider(...);
        var domainOwnershipPipeline = context.SyntaxProvider.CreateSyntaxProvider(...);
        var projectionsPipeline = context.SyntaxProvider.CreateSyntaxProvider(...);
        
        // Combine all sources for cross-project aggregation
        var combinedPipeline = handlersPipeline
            .Combine(domainOwnershipPipeline)
            .Combine(projectionsPipeline);
            
        context.RegisterSourceOutput(combinedPipeline, GenerateCode);
        context.RegisterSourceOutput(combinedPipeline, GenerateMetadata); // For IDE service
    }
}

// Generated metadata for IDE navigation service
public class WhizbangNavigationMetadata {
    public Dictionary<string, EventStreamInfo> EventStreams { get; set; }
    public Dictionary<string, HandlerInfo> Handlers { get; set; }
    public Dictionary<string, ProjectionInfo> Projections { get; set; }
    public Dictionary<string, DomainInfo> Domains { get; set; }
}
```

**IDE Integration Features**:
- GitLens-style event stream navigation
- Command → Handler → Events → Projections flow visualization
- Analyzer errors for misconfigured ownership/handlers
- Code fixes for common patterns

---

### 20. Driver Loading & Plugin Architecture ✅ **RESOLVED**

**Decision**: Option A - Explicit registration for simplicity and predictability

**Implementation**:
```csharp
services.AddWhizbang(options => {
    options.UseEventStoreDriver<PostgresDriver>("connection-string");
    options.UseProjectionDriver<MongoDriver>("mongo-connection");
    options.UseMessageBrokerDriver<KafkaDriver>(kafka => {
        kafka.BootstrapServers = "localhost:9092";
        kafka.EnableIdempotence = true;
    });
});
```

**Benefits**:
- Clear, explicit dependencies
- Compile-time safety
- Predictable behavior
- Easy to reason about and debug
- Works well with dependency injection

---

### 21. Message Serialization Strategy ✅ **RESOLVED**

**Decision**: Duck-typed serialization with System.Text.Json default + abstraction layer

**Key Principles**:
- **Decoupled microservices** - No shared dependencies required
- **Duck typing** - Service1.EventA can deserialize to Service5.EventC if shapes match
- **Interface support** - Both duck-typed and pure-shared interfaces
- **Pure type sharing** - Support shared Domain Models libraries when desired
- **Zero-copy optimization** - When applicable through adapters
- **Compression support** - Through driver adapters

**Implementation Architecture**:
```csharp
// Duck-typed serialization example
// Service 1 publishes:
public record OrderPlaced(Guid OrderId, string CustomerName, decimal Total);

// Service 5 receives as:
public record OrderReceived(Guid OrderId, string CustomerName, decimal Total);
// Works automatically via duck typing

// Interface-based approach (optional)
public interface IOrderEvent {
    Guid OrderId { get; }
    string CustomerName { get; }
    decimal Total { get; }
}

// Both services can implement the interface
public record OrderPlaced(...) : IOrderEvent;
public record OrderReceived(...) : IOrderEvent;

// Serialization configuration
services.AddWhizbang(options => {
    options.Serialization(serialization => {
        serialization.DefaultSerializer = SystemTextJsonSerializer.Default;
        serialization.EnableDuckTyping = true;
        serialization.EnableInterfaceMapping = true;
        serialization.EnableZeroCopy = true; // When supported by driver
        
        // Driver-specific optimizations
        serialization.ForDriver<PostgresDriver>()
            .UseJsonOptimizations(jsonb: true);
        serialization.ForDriver<KafkaDriver>()
            .UseCompression(CompressionType.Gzip);
    });
});
```

**Duck Typing Implementation**:
```csharp
public interface IMessageSerializer {
    T Deserialize<T>(byte[] data, Type sourceType);
    byte[] Serialize<T>(T message);
    bool CanDuckType(Type source, Type target);
}

public class DuckTypingJsonSerializer : IMessageSerializer {
    public T Deserialize<T>(byte[] data, Type sourceType) {
        if (typeof(T) == sourceType) {
            return JsonSerializer.Deserialize<T>(data);
        }
        
        // Duck typing: deserialize to JObject then convert
        var json = JsonSerializer.Deserialize<JsonObject>(data);
        return json.Deserialize<T>();
    }
}
```

---

### 22. Error Handling & Resilience Patterns ✅ **RESOLVED**

**Decision**: Use Polly as the resilience framework with Whizbang-specific defaults and policies

**Core Principle**: **Never lose data** - prefer backing up streams over discarding messages

**Implementation Strategy**:
```csharp
services.AddWhizbang(options => {
    options.Resilience(resilience => {
        // Default policies (can be overridden)
        resilience.DefaultRetryPolicy = Policy
            .Handle<TransientException>()
            .WaitAndRetryAsync(3, retryAttempt => 
                TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)));
                
        resilience.DefaultCircuitBreakerPolicy = Policy
            .Handle<Exception>()
            .CircuitBreakerAsync(5, TimeSpan.FromMinutes(1));
            
        // Data integrity first - back up rather than lose
        resilience.OnMaxRetriesExceeded = (context, exception) => {
            // Back up the stream, don't discard
            return ResilienceAction.BackupAndHold;
        };
        
        // Per-event/interface/pattern customization
        resilience.ForEvent<OrderPlaced>()
            .UseRetryPolicy(customOrderRetryPolicy);
            
        resilience.ForInterface<IProjectionHandler>()
            .UseCircuitBreaker(projectionCircuitBreaker);
            
        resilience.ForPattern(type => type.Name.EndsWith("Command"))
            .UseTimeout(TimeSpan.FromSeconds(30));
    });
});
```

**Default Behaviors with Safety Warnings**:
```csharp
// Safe defaults
public static class DefaultResiliencePolicies {
    public static ResiliencePolicy SafeDefault => new() {
        MaxRetries = 3,
        BackoffStrategy = BackoffStrategy.ExponentialWithJitter,
        OnFailure = ResilienceAction.BackupAndHold, // SAFE: Don't lose data
        CircuitBreakerThreshold = 5,
        CircuitBreakerDuration = TimeSpan.FromMinutes(1)
    };
    
    // Dangerous overrides (with warnings)
    [Obsolete("WARNING: This policy may result in data loss. Use SafeDefault unless you understand the risks.")]
    public static ResiliencePolicy DangerousDiscardOnFailure => new() {
        OnFailure = ResilienceAction.Discard // DANGEROUS: May lose data
    };
}
```

**Customizable Hooks**:
```csharp
// Global hooks
resilience.OnTransientFailure = async (context, exception) => {
    await _logger.LogWarningAsync($"Transient failure in {context.HandlerType}: {exception.Message}");
};

resilience.OnPermanentFailure = async (context, exception) => {
    await _alerting.SendCriticalAlert($"Permanent failure in {context.HandlerType}: {exception.Message}");
    await _deadLetterQueue.SendAsync(context.Message, exception);
};
```

---

### 23. Configuration Management Strategy ✅ **RESOLVED**

**Decision**: Hybrid approach - Options B & C (fluent + configuration) with Policy Engine integration

**Implementation Strategy**:
```csharp
// Fluent builder for type safety and discoverability
services.AddWhizbang(options => {
    options.UseEventStore<PostgresDriver>("connection-string")
           .UseProjections(proj => proj.DefaultStrategy = SnapshotStrategy.Automatic)
           .UseDomainOwnership(dom => dom.PrecedenceOrder("Namespace", "Attributes"))
           .UseMultiTenancy(mt => mt.DefaultStrategy = TenancyStrategy.SingleDatabase);
           
    // Policy-driven configuration
    options.Policies(policies => {
        policies.ForEnvironment("Production")
                .LoadFromConfiguration("ProductionPolicies");
        policies.ForEnvironment("Development")
                .Apply(DevelopmentPolicies.Default);
    });
});

// Configuration sections for environment-specific overrides
{
  "Whizbang": {
    "EventStore": { "Driver": "Postgres", "ConnectionString": "..." },
    "Projections": { "DefaultStrategy": "Automatic" },
    "Policies": {
      "Production": [...],
      "Development": [...]
    }
  }
}
```

**Benefits**:
- **Type safety** through fluent builder
- **Flexibility** through configuration sections
- **Policy-driven behavior** for environment adaptation
- **Validation** at startup with clear error messages

---

### 24. Testing Strategy & Test Helpers ✅ **RESOLVED**

**Decision**: Provide comprehensive testing library including suggested helpers

**Implementation**:
```csharp
// Whizbang.Testing package
public class WhizbangTestFixture {
    public GivenEventsBuilder Given(params object[] events);
    public WhenCommandBuilder When(ICommand command);
    public ThenEventsBuilder Then();
    
    // Projection testing
    public ProjectionTestBuilder ForProjection<TProjection>();
    
    // Policy testing
    public PolicyTestBuilder ForPolicy(string policyName);
}

// Usage in tests
[Test]
public async Task PlaceOrder_ShouldEmitOrderPlaced() {
    await _fixture
        .Given(new CustomerRegistered(customerId, "John Doe"))
        .When(new PlaceOrder(orderId, customerId, items))
        .Then()
        .ShouldEmitEvent<OrderPlaced>()
        .WithProperty(e => e.CustomerId, customerId);
}

// In-memory drivers for testing
services.AddWhizbang(options => {
    options.UseInMemoryEventStore()  // For unit tests
           .UseInMemoryProjections()
           .UseInMemoryMessageBroker();
});
```

**Features**:
- **In-memory drivers** for fast unit testing
- **Given/When/Then** fluent test API
- **Projection test helpers** with event feeding
- **Policy testing** for complex rule validation
- **Integration test helpers** with test containers

---

### 25. Metrics & Observability Data Model ✅ **RESOLVED**

**Decision**: Configurable metrics with policy-driven verbosity and custom field attributes

**Default Metrics (Always Enabled)**:
```csharp
// Core performance metrics
whizbang_command_duration_seconds{command_type, domain, handler_type}
whizbang_command_total{command_type, domain, status}
whizbang_event_processing_duration_seconds{event_type, handler_type}
whizbang_projection_lag_seconds{projection_name}

// Infrastructure health
whizbang_event_store_append_duration_seconds{driver_type}
whizbang_message_broker_publish_duration_seconds{broker_type}
```

**Policy-Driven Observability**:
```csharp
services.AddWhizbang(options => {
    options.Observability(obs => {
        obs.DefaultLevel = ObservabilityLevel.Standard;
        
        // Policy-based observability levels
        obs.Policies(policies => {
            policies.When(ctx => ctx.HasFlag(WhizbangFlags.VerboseOtel))
                    .Then(action => action.SetObservabilityLevel(ObservabilityLevel.Verbose));
                    
            policies.When(ctx => ctx.HasTag("critical-path"))
                    .Then(action => action.EnableDetailedMetrics())
                    .And(action => action.CaptureCustomFields());
        });
    });
});
```

**Custom Field Attributes for Source Generation**:
```csharp
// Add fields to metadata via attributes
public record OrderPlaced(
    Guid OrderId,
    [ObservabilityField] Guid CustomerId,    // Include in metrics
    [ObservabilityField] decimal Total,      // Include in metrics
    List<OrderItem> Items
);

// Generated metric includes custom fields
whizbang_event_published_total{event_type="OrderPlaced", customer_id="123", total_range="1000-5000"}
```

---

### 26. Development Experience & Tooling ✅ **RESOLVED**

**Decision**: Comprehensive tooling suite as outlined

**Planned Tools**:
```bash
# CLI tool (whizbang-cli)
whizbang new --template microservice --name OrderService
whizbang add projection --name OrderSummary --events OrderPlaced,OrderShipped
whizbang migrate --from 1.0 --to 2.0
whizbang dashboard --port 5000
whizbang replay --stream orders --from 2024-01-01

# Visual Studio integration
dotnet new whizbang-service --name MyService
dotnet new whizbang-projection --name OrderSummary
```

**IDE Extensions**:
- **Navigation service** for GitLens-style event stream traversal
- **Code analyzers** for ownership and pattern validation
- **Live templates** for commands, events, projections, sagas
- **Debugging tools** with state inspection and replay

**Web Dashboard**:
- Real-time projection lag monitoring
- Event stream visualization
- Policy rule testing and validation
- Performance metrics and alerting

**Documentation**: Dedicated tools page and documentation section

---

### 27. Deployment & Operations Patterns ✅ **RESOLVED**

**Decision**: Embedded library with comprehensive operational hooks

**Deployment Model**:
- **Embedded library** - Runs within developer's service
- **Built-in health checks** - Ready for Kubernetes probes
- **Graceful shutdown** - Message draining support
- **.NET integration** - Hooks into .NET hosting lifetime

**Implementation**:
```csharp
// Built-in health checks
services.AddWhizbang(options => {
    options.HealthChecks(health => {
        health.CheckEventStoreConnection = true;
        health.CheckProjectionLag = true;
        health.CheckMessageBrokerConnection = true;
        health.ProjectionLagThreshold = TimeSpan.FromMinutes(5);
    });
});

// Graceful shutdown integration
public class WhizbangHostedService : IHostedService {
    public async Task StopAsync(CancellationToken cancellationToken) {
        // Drain in-flight messages
        await _messageProcessor.DrainAsync(cancellationToken);
        // Stop accepting new messages
        await _messageSubscriptions.StopAsync(cancellationToken);
    }
}
```

---

## 🟢 Future Enhancement Questions

### 28. Event Store Scaling Patterns ✅ **RESOLVED**

**Decision**: All suggested scaling patterns should be available as options

**Scaling Options**:
- **Sharding strategies** - By tenant, aggregate type, time, or custom logic
- **Read replicas** - For query load distribution
- **Event archiving** - Automated cold storage migration
- **Cross-shard projections** - With aggregation support

### 29. Advanced Saga Patterns

**Question**: Should Whizbang support more sophisticated saga patterns?

**Considerations**:
- **Saga compensation** - Automatic rollback workflows
- **Saga timeouts** - What happens when sagas get stuck
- **Nested sagas** - Sagas that spawn other sagas
- **Saga state queries** - Query current saga states

### 30. Real-time Features

**Question**: How should Whizbang support real-time scenarios?

**Considerations**:
- **Live projections** - Real-time projection updates
- **Event streaming** - WebSocket/SSE event feeds
- **Push notifications** - Mobile/web notifications
- **Live dashboards** - Real-time metrics and monitoring

---

## Decision Process for New Questions

1. **Prioritize by impact** - Focus on critical implementation blockers first
2. **Prototype when uncertain** - Build spikes to validate approaches
3. **Consider ecosystem integration** - How do decisions affect .NET ecosystem fit
4. **Balance simplicity vs power** - Don't over-engineer early decisions
5. **Document decisions** - Update specifications as decisions are made

**Next Steps**: Review and prioritize these questions for the implementation phase.
