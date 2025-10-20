---
title: Flags & Tags System
category: Architecture & Design
order: 11
tags: flags, tags, message-context, routing, debugging, cross-service
---

# Flags & Tags System

Whizbang provides a sophisticated flags and tags system for message context, enabling dynamic behavior modification, cross-service debugging, and flexible routing throughout the entire message lifecycle.

## Core Concepts

### Flags (Library-Defined)

**Hardcoded enum flags** provided by Whizbang for common scenarios:

```csharp
[Flags]
public enum WhizbangFlags : long {
    None = 0,
    
    // Testing & Development
    LoadTesting = 1 << 0,           // Don't replay these events
    DryRun = 1 << 1,                // Execute handlers but don't persist
    Development = 1 << 2,           // Development mode behaviors
    TraceReplay = 1 << 3,           // Replay/trace mode
    
    // Debugging & Inspection
    VerboseLogging = 1 << 4,        // Increase logging verbosity
    VerboseOtel = 1 << 5,           // Increase OpenTelemetry verbosity
    IgnoreTimeouts = 1 << 6,        // Bypass timeouts for debugging
    CursorMode = 1 << 7,            // IDE cursor/scrubbing mode
    Breakpoint = 1 << 8,            // Trigger breakpoints
    
    // Security & Compliance
    SecurityBypass = 1 << 9,        // Bypass security checks (dangerous)
    DataScrubbing = 1 << 10,        // Scrub sensitive data
    ComplianceMode = 1 << 11,       // Extra compliance logging
    
    // Routing & Delivery
    AlternativeRouting = 1 << 12,   // Use alternative handlers
    PriorityDelivery = 1 << 13,     // Expedite processing
    DelayedProcessing = 1 << 14,    // Defer processing
    
    // Environment & Lifecycle
    Production = 1 << 15,           // Production environment
    Staging = 1 << 16,              // Staging environment
    QA = 1 << 17,                   // QA environment
    Migration = 1 << 18,            // Data migration context
    
    // Custom ranges for user-defined flags
    UserDefined1 = 1 << 32,
    UserDefined2 = 1 << 33,
    // ... up to 1 << 63
}
```

### Tags (User-Defined)

**Arbitrary string tags** added by developers for custom scenarios:

```csharp
public class MessageContext {
    public WhizbangFlags Flags { get; set; }
    public HashSet<string> Tags { get; set; } = new();
    public string? CorrelationId { get; set; }
    public string? TenantId { get; set; }
    public string? Domain { get; set; }
    
    // Fluent API for context building
    public MessageContext WithTag(string tag) {
        Tags.Add(tag);
        return this;
    }
    
    public MessageContext WithFlags(WhizbangFlags flags) {
        Flags |= flags;
        return this;
    }
    
    public MessageContext WithCorrelationId(string correlationId) {
        CorrelationId = correlationId;
        return this;
    }
    
    public bool HasFlag(WhizbangFlags flag) => (Flags & flag) == flag;
    public bool HasTag(string tag) => Tags.Contains(tag);
    public bool HasAnyTag(params string[] tags) => tags.Any(Tags.Contains);
    public bool HasAllTags(params string[] tags) => tags.All(Tags.Contains);
}

// Usage examples
context.WithTag("customer-priority")
       .WithTag("region-us-west")
       .WithTag("high-value-order")
       .WithFlags(WhizbangFlags.VerboseLogging | WhizbangFlags.PriorityDelivery)
       .WithCorrelationId("debug-session-123");
```

## Cross-Service Propagation

### Automatic Flag Propagation

**Flags carry through entire message journey** across service boundaries:

```csharp
// Service 1: Initial command with debugging flags
var command = new PlaceOrder(orderId, customerId, items);
await _mediator.Send(command, context => {
    context.WithFlags(WhizbangFlags.VerboseLogging | WhizbangFlags.TraceReplay)
           .WithTag("debug-session-123")
           .WithTag("customer-vip");
});

// Flags automatically propagate to:
// 1. Command handler execution in Service 1
// 2. Event publishing from Service 1
// 3. Cross-service event delivery via message broker
// 4. Event handler execution in Service 2
// 5. Projection updates in Service 2
// 6. Saga execution across services

// Service 2: Receives event with same flags and tags
public class InventoryHandler : IEventHandler<OrderPlaced> {
    public async Task Handle(OrderPlaced @event, EventContext context) {
        // context.Flags contains VerboseLogging | TraceReplay
        // context.Tags contains "debug-session-123", "customer-vip"
        
        if (context.HasFlag(WhizbangFlags.VerboseLogging)) {
            _logger.LogInformation("Processing order with verbose logging enabled for debug session {DebugSession}", 
                context.Tags.FirstOrDefault(t => t.StartsWith("debug-session")));
        }
        
        if (context.HasTag("customer-vip")) {
            // Special handling for VIP customers
            await _vipCustomerService.NotifyOrderReceived(@event.OrderId);
        }
    }
}
```

### Message Context Serialization

**Context travels with messages** across all transport mechanisms:

```csharp
// Message envelope for cross-service communication
public class MessageEnvelope<T> {
    public T Message { get; set; }
    public MessageContext Context { get; set; }
    public Dictionary<string, string> Headers { get; set; } = new();
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;
}

// Automatic context serialization in message brokers
public class KafkaMessagePublisher : IMessagePublisher {
    public async Task PublishAsync<T>(T message, MessageContext context) {
        var envelope = new MessageEnvelope<T> {
            Message = message,
            Context = context,
            Headers = new Dictionary<string, string> {
                ["whizbang-flags"] = ((long)context.Flags).ToString(),
                ["whizbang-tags"] = string.Join(",", context.Tags),
                ["whizbang-correlation-id"] = context.CorrelationId ?? "",
                ["whizbang-tenant-id"] = context.TenantId ?? "",
                ["whizbang-domain"] = context.Domain ?? ""
            }
        };
        
        await _kafkaProducer.ProduceAsync(GetTopicName<T>(), envelope);
    }
}
```

## Debugging and Development Features

### IDE Cursor/Scrubbing Mode

**Interactive debugging** with state inspection:

```csharp
// IDE integration for step-by-step debugging
public class CursorModeHandler : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message,
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        if (context.HasFlag(WhizbangFlags.CursorMode)) {
            // Capture pre-execution state
            var preState = await _stateCapture.CaptureStateAsync(context);
            
            // Notify IDE of execution point
            await _ideNotificationService.NotifyExecutionPoint(new ExecutionPoint {
                MessageType = typeof(TRequest).Name,
                HandlerType = context.HandlerType?.Name,
                CorrelationId = context.CorrelationId,
                State = preState,
                CanStepForward = true,
                CanStepBackward = true
            });
            
            // Wait for IDE to signal continue
            await _ideNotificationService.WaitForContinueSignal(context.CorrelationId);
        }
        
        var response = await next(message, context);
        
        if (context.HasFlag(WhizbangFlags.CursorMode)) {
            // Capture post-execution state
            var postState = await _stateCapture.CaptureStateAsync(context);
            
            await _ideNotificationService.NotifyExecutionComplete(new ExecutionResult {
                CorrelationId = context.CorrelationId,
                Response = response,
                PostState = postState,
                ExecutionTime = context.ExecutionTime
            });
        }
        
        return response;
    }
}
```

### Breakpoint System

**Programmatic breakpoints** triggered by flags:

```csharp
public class BreakpointHandler : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message,
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        if (context.HasFlag(WhizbangFlags.Breakpoint)) {
            var breakpointContext = new BreakpointContext {
                BreakpointId = Guid.NewGuid(),
                MessageType = typeof(TRequest).Name,
                Message = message,
                Context = context,
                StackTrace = Environment.StackTrace,
                Timestamp = DateTimeOffset.UtcNow
            };
            
            // Store breakpoint information
            await _breakpointStore.StoreBreakpointAsync(breakpointContext);
            
            // Notify debugging tools
            await _debuggerNotificationService.NotifyBreakpointHit(breakpointContext);
            
            // Optionally pause execution for attached debuggers
            if (_debuggerService.IsAttached) {
                System.Diagnostics.Debugger.Break();
            }
        }
        
        return await next(message, context);
    }
}
```

## Data Scrubbing and Security

### Automatic Data Scrubbing

**Policy-driven data sanitization** based on flags:

```csharp
public class DataScrubbingInterceptor : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message,
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        TRequest processedMessage = message;
        
        if (context.HasFlag(WhizbangFlags.DataScrubbing)) {
            // Apply data scrubbing rules
            processedMessage = await _dataScrubber.ScrubAsync(message, new ScrubOptions {
                ScrubPersonalData = true,
                ScrubFinancialData = true,
                ScrubSensitiveFields = true,
                PreserveFunctionality = true,
                AddScrubbedMarkers = true
            });
            
            // Add scrubbing metadata to context
            context.Tags.Add("data-scrubbed");
            context.Tags.Add($"scrubbed-at-{DateTimeOffset.UtcNow:yyyy-MM-dd-HH-mm-ss}");
        }
        
        return await next(processedMessage, context);
    }
}

// Data scrubbing rules
public class OrderDataScrubber : IDataScrubber<PlaceOrder> {
    public async Task<PlaceOrder> ScrubAsync(PlaceOrder order, ScrubOptions options) {
        return order with {
            // Scrub customer email
            CustomerEmail = options.ScrubPersonalData ? ScrubEmail(order.CustomerEmail) : order.CustomerEmail,
            
            // Scrub payment information
            PaymentToken = options.ScrubFinancialData ? "[SCRUBBED-PAYMENT-TOKEN]" : order.PaymentToken,
            
            // Preserve order structure but scrub sensitive data
            Items = order.Items.Select(item => item with {
                ProductName = options.PreserveFunctionality ? item.ProductName : $"Product-{item.ProductId.ToString()[..8]}"
            }).ToList()
        };
    }
}
```

### Production to QA Data Flow

**Secure data replication** with automatic scrubbing:

```csharp
// Handler that duplicates production messages to QA with scrubbing
public class ProductionToQAReplicator : IEventHandler<object> {
    public async Task Handle(object @event, EventContext context) {
        // Only replicate events tagged for QA replication
        if (context.HasTag("production-data") && 
            context.HasFlag(WhizbangFlags.QA)) {
            
            // Create a copy with scrubbing flag
            var qaCopy = @event;
            var qaContext = context.Copy()
                .WithFlag(WhizbangFlags.DataScrubbing)
                .WithTag("qa-replicated")
                .WithTag($"replicated-from-production-{DateTimeOffset.UtcNow:yyyy-MM-dd}");
            
            // Remove production-specific tags
            qaContext.Tags.Remove("production-data");
            qaContext.Tags.Remove("customer-vip"); // Don't carry VIP status to QA
            
            // Route to QA environment
            await _qaEventPublisher.PublishAsync(qaCopy, qaContext);
        }
    }
}
```

## Performance and Load Testing

### Load Testing Flag Handling

**Optimize behavior for load testing scenarios**:

```csharp
public class LoadTestingOptimizer : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message,
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        if (context.HasFlag(WhizbangFlags.LoadTesting)) {
            // Optimize for load testing
            using var loadTestScope = _performanceOptimizer.EnterLoadTestMode();
            
            // Disable slow operations
            context.Tags.Add("skip-audit-logging");
            context.Tags.Add("skip-analytics-tracking");
            context.Tags.Add("minimal-validation");
            
            // Add load test metadata
            context.Tags.Add($"load-test-batch-{GetLoadTestBatch()}");
            context.Tags.Add($"load-test-thread-{Thread.CurrentThread.ManagedThreadId}");
            
            // Execute with load test optimizations
            return await next(message, context);
        }
        
        return await next(message, context);
    }
    
    private string GetLoadTestBatch() {
        // Identify which load test batch this belongs to
        return Environment.GetEnvironmentVariable("LOAD_TEST_BATCH_ID") ?? "unknown";
    }
}
```

## Advanced Routing Scenarios

### Dynamic Handler Selection

**Route to different handlers** based on flags and tags:

```csharp
// Handler factory that selects implementation based on context
public class ContextAwareHandlerFactory<T> : ICommandHandler<T> where T : ICommand {
    private readonly IServiceProvider _serviceProvider;
    private readonly IHandlerRoutingRules _routingRules;
    
    public async Task Handle(T command, MessageContext context) {
        var handlerType = await _routingRules.DetermineHandlerType<T>(context);
        var handler = (ICommandHandler<T>)_serviceProvider.GetRequiredService(handlerType);
        
        return await handler.Handle(command, context);
    }
}

// Routing rules based on context
public class HandlerRoutingRules : IHandlerRoutingRules {
    public async Task<Type> DetermineHandlerType<T>(MessageContext context) {
        // VIP customers get premium handler
        if (context.HasTag("customer-vip")) {
            return typeof(PremiumOrderHandler);
        }
        
        // Load testing gets optimized handler
        if (context.HasFlag(WhizbangFlags.LoadTesting)) {
            return typeof(LoadTestOptimizedOrderHandler);
        }
        
        // Migration data gets special handler
        if (context.HasFlag(WhizbangFlags.Migration)) {
            return typeof(DataMigrationOrderHandler);
        }
        
        // Default handler
        return typeof(StandardOrderHandler);
    }
}
```

## Configuration and Management

### Flag Management

**Control flag behavior** through configuration:

```csharp
services.AddWhizbang(options => {
    options.Flags(flags => {
        // Environment-based flag defaults
        if (_environment.IsDevelopment()) {
            flags.DefaultFlags = WhizbangFlags.Development | WhizbangFlags.VerboseLogging;
        } else if (_environment.IsProduction()) {
            flags.DefaultFlags = WhizbangFlags.Production;
            flags.RestrictedFlags = WhizbangFlags.SecurityBypass | WhizbangFlags.DataScrubbing;
        }
        
        // Flag validation rules
        flags.AddValidationRule(ctx => {
            if (ctx.HasFlag(WhizbangFlags.SecurityBypass) && !ctx.HasTag("authorized-security-bypass")) {
                throw new UnauthorizedFlagException("SecurityBypass flag requires authorization");
            }
        });
        
        // Automatic flag addition based on context
        flags.AddAutoFlag(WhizbangFlags.ComplianceMode, 
            condition: ctx => ctx.HasTag("pci-data") || ctx.HasTag("gdpr-data"));
    });
});
```

### Tag Lifecycle Management

**Manage tag propagation and cleanup**:

```csharp
public class TagLifecycleManager : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message,
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        // Add automatic tags
        context.Tags.Add($"processed-at-{Environment.MachineName}");
        context.Tags.Add($"handler-{typeof(TRequest).Name}");
        
        // Remove expired tags
        var expiredTags = context.Tags
            .Where(tag => tag.StartsWith("session-") && IsSessionExpired(tag))
            .ToList();
        
        foreach (var expiredTag in expiredTags) {
            context.Tags.Remove(expiredTag);
        }
        
        var response = await next(message, context);
        
        // Add response-based tags
        if (response is ISuccessResult) {
            context.Tags.Add("execution-success");
        } else if (response is IErrorResult error) {
            context.Tags.Add($"execution-error-{error.ErrorCode}");
        }
        
        return response;
    }
}
```

## Best Practices

### Flag Usage Guidelines

1. **Use library flags first** - Prefer built-in flags over custom tags when possible
2. **Document custom flags** - Make user-defined flags clear to the team
3. **Be conservative with propagation** - Not all flags should cross service boundaries
4. **Consider flag lifetime** - How long should flags persist in the system
5. **Audit flag usage** - Track which flags are used and where

### Tag Design Principles

1. **Hierarchical naming** - Use consistent naming conventions (e.g., "customer-vip", "region-us-west")
2. **Meaningful values** - Tags should be self-documenting
3. **Avoid high cardinality** - Don't create too many unique tag combinations
4. **Lifecycle awareness** - Consider when tags should be added/removed
5. **Security sensitivity** - Don't include sensitive data in tag names

### Security Considerations

1. **Validate flag sources** - Ensure flags come from trusted sources
2. **Limit dangerous flags** - SecurityBypass should be heavily restricted
3. **Audit flag changes** - Log all flag modifications
4. **Encrypt sensitive tags** - Some tags may contain sensitive information
5. **Principle of least privilege** - Flags should grant minimal necessary permissions

---

## Related Documentation

- [**Policy Engine**](./policy-engine.md) - How policies use flags and tags for decision making
- [**Observability & Metrics**](./observability-metrics.md) - Flag-driven observability levels
- [**Testing & Development Tools**](./testing-development-tools.md) - Testing with flags and tags