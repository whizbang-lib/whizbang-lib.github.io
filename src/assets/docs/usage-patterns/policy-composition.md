---
title: Policy Composition
category: Usage Patterns
order: 7
tags: policies, resilience, retry, circuit-breaker, composition
description: Building resilient applications with composable policies for retry, circuit breaking, timeouts, and fallbacks
---

# Policy Composition

## Overview

Policy Composition in Whizbang allows you to build resilient applications by combining multiple policies like retry, circuit breaker, timeout, and fallback. Inspired by Polly's approach but integrated seamlessly with our aspect-oriented architecture.

## Core Concepts

### Policies as Aspects

In Whizbang, resilience policies are first-class aspects that can be composed declaratively:

```csharp{
title: "Declarative Policy Composition"
description: "Combine multiple resilience policies via attributes"
framework: "NET8"
category: "Resilience"
difficulty: "INTERMEDIATE"
tags: ["Policies", "Resilience", "Aspects"]
nugetPackages: ["Whizbang.Core"]
filename: "ResilientHandler.cs"
showLineNumbers: true
highlightLines: [1, 2, 3, 4]
usingStatements: ["Whizbang", "System"]
}
[Retry(3, Backoff = "exponential", DelayMs = 100)]
[CircuitBreaker(Threshold = 5, Duration = "30s")]
[Timeout(Seconds = 10)]
[Fallback(typeof(OrderFallbackHandler))]
public class OrderHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd, IOrderService service) {
        // This handler is automatically wrapped with:
        // 1. Exponential backoff retry (3 attempts)
        // 2. Circuit breaker (opens after 5 failures)
        // 3. 10-second timeout
        // 4. Fallback handler if all else fails
        
        var order = service.CreateOrder(cmd);
        return new OrderCreated(order.Id);
    }
}
```

## Basic Policies

### Retry Policy

```csharp{
title: "Retry Policy Examples"
description: "Different retry strategies for various scenarios"
framework: "NET8"
category: "Resilience"
difficulty: "BEGINNER"
tags: ["Retry", "Resilience", "Error Handling"]
nugetPackages: ["Whizbang.Core"]
filename: "RetryExamples.cs"
showLineNumbers: true
usingStatements: ["Whizbang", "System"]
}
// Simple retry with fixed delay
[Retry(3, DelayMs = 1000)]
public class SimpleRetryHandler : IHandle<ProcessPayment> {
    public PaymentProcessed Handle(ProcessPayment cmd) {
        return paymentGateway.Process(cmd);
    }
}

// Exponential backoff
[Retry(5, Backoff = "exponential", DelayMs = 100, MaxDelayMs = 10000)]
public class ExponentialRetryHandler : IHandle<CallExternalApi> {
    // Delays: 100ms, 200ms, 400ms, 800ms, 1600ms
    public ApiResponse Handle(CallExternalApi cmd) {
        return externalApi.Call(cmd);
    }
}

// Retry only specific exceptions
[Retry(3, 
    RetryOn = new[] { typeof(TransientException), typeof(TimeoutException) },
    SkipOn = new[] { typeof(ValidationException) }
)]
public class SelectiveRetryHandler : IHandle<UpdateInventory> {
    public InventoryUpdated Handle(UpdateInventory cmd) {
        return inventory.Update(cmd);
    }
}

// Retry with jitter to prevent thundering herd
[Retry(3, Backoff = "exponential-jitter", DelayMs = 100)]
public class JitteredRetryHandler : IHandle<BulkOperation> {
    // Adds randomization to prevent synchronized retries
    public BulkResult Handle(BulkOperation cmd) {
        return bulkService.Process(cmd);
    }
}
```

### Circuit Breaker

```csharp{
title: "Circuit Breaker Policy"
description: "Prevent cascading failures with circuit breaker pattern"
framework: "NET8"
category: "Resilience"
difficulty: "INTERMEDIATE"
tags: ["Circuit Breaker", "Resilience", "Fault Tolerance"]
nugetPackages: ["Whizbang.Core"]
filename: "CircuitBreakerExamples.cs"
showLineNumbers: true
highlightLines: [1, 15, 29]
usingStatements: ["Whizbang", "System"]
}
// Basic circuit breaker
[CircuitBreaker(
    Threshold = 5,           // Open after 5 failures
    Duration = "30s",        // Stay open for 30 seconds
    SuccessesRequired = 2    // Need 2 successes to close
)]
public class ProtectedHandler : IHandle<CallDownstreamService> {
    public ServiceResponse Handle(CallDownstreamService cmd) {
        return downstreamService.Call(cmd);
    }
}

// Advanced circuit breaker with sampling
[CircuitBreaker(
    SamplingDuration = "10s",     // Sample over 10 seconds
    FailureRate = 0.5,            // Open if 50% of calls fail
    MinimumThroughput = 10,       // Need at least 10 calls in window
    Duration = "60s"               // Stay open for 60 seconds
)]
public class AdvancedCircuitHandler : IHandle<HighVolumeOperation> {
    public OperationResult Handle(HighVolumeOperation cmd) {
        return highVolumeService.Execute(cmd);
    }
}

// Circuit breaker with custom break condition
[CircuitBreaker(
    BreakOn = result => result is ErrorResult { Code: "CRITICAL" },
    Duration = "120s"
)]
public class CustomBreakHandler : IHandle<CriticalOperation> {
    public Result<OperationSuccess> Handle(CriticalOperation cmd) {
        return criticalService.Execute(cmd);
    }
}
```

### Timeout Policy

```csharp{
title: "Timeout Policy"
description: "Prevent operations from running indefinitely"
framework: "NET8"
category: "Resilience"
difficulty: "BEGINNER"
tags: ["Timeout", "Resilience", "Performance"]
nugetPackages: ["Whizbang.Core"]
filename: "TimeoutExamples.cs"
showLineNumbers: true
usingStatements: ["Whizbang", "System", "System.Threading"]
}
// Simple timeout
[Timeout(Seconds = 5)]
public class TimeoutHandler : IHandle<LongRunningQuery> {
    public QueryResult Handle(LongRunningQuery query) {
        return database.ExecuteComplexQuery(query);
    }
}

// Pessimistic timeout (cancels the operation)
[Timeout(Seconds = 10, Mode = "pessimistic")]
public class PessimisticTimeoutHandler : IHandle<CancellableOperation> {
    public async Task<Result> Handle(CancellableOperation cmd, CancellationToken ct) {
        // Operation receives cancellation token
        return await longService.ExecuteAsync(cmd, ct);
    }
}

// Optimistic timeout (just gives up waiting)
[Timeout(Seconds = 3, Mode = "optimistic")]
public class OptimisticTimeoutHandler : IHandle<FireAndForget> {
    public void Handle(FireAndForget cmd) {
        // We stop waiting after 3 seconds, but operation continues
        backgroundService.Process(cmd);
    }
}
```

### Fallback Policy

```csharp{
title: "Fallback Policy"
description: "Provide alternative results when primary operation fails"
framework: "NET8"
category: "Resilience"
difficulty: "INTERMEDIATE"
tags: ["Fallback", "Resilience", "Error Recovery"]
nugetPackages: ["Whizbang.Core"]
filename: "FallbackExamples.cs"
showLineNumbers: true
highlightLines: [1, 12, 23]
usingStatements: ["Whizbang", "System"]
}
// Fallback to another handler
[Fallback(typeof(CachedDataHandler))]
public class LiveDataHandler : IHandle<GetProductData> {
    public ProductData Handle(GetProductData query) {
        return liveService.GetProduct(query.ProductId);
    }
}

// Fallback with inline value
[Fallback(Value = "DefaultResponse")]
public class ServiceHandler : IHandle<GetConfiguration> {
    public string Handle(GetConfiguration query) {
        return configService.Get(query.Key);
    }
}

// Fallback with factory method
[Fallback(Factory = nameof(CreateDefaultOrder))]
public class OrderHandler : IHandle<GetOrder> {
    public Order Handle(GetOrder query) {
        return orderService.Get(query.OrderId);
    }
    
    private Order CreateDefaultOrder(GetOrder query) {
        return new Order { 
            Id = query.OrderId, 
            Status = "Unknown",
            Items = new List<OrderItem>()
        };
    }
}
```

## Advanced Composition

### Policy Wrapping

```csharp{
title: "Advanced Policy Composition"
description: "Combine multiple policies for comprehensive resilience"
framework: "NET8"
category: "Resilience"
difficulty: "ADVANCED"
tags: ["Policy Composition", "Resilience", "Advanced"]
nugetPackages: ["Whizbang.Core"]
filename: "AdvancedComposition.cs"
showLineNumbers: true
highlightLines: [1, 2, 3, 4, 5]
usingStatements: ["Whizbang", "System"]
}
// Policies execute in order: Retry -> CircuitBreaker -> Timeout -> Fallback
[Retry(3, Backoff = "exponential")]
[CircuitBreaker(Threshold = 10, Duration = "60s")]
[Timeout(Seconds = 5)]
[Fallback(typeof(CachedInventoryHandler))]
[Logged(OnError = true)]
public class ResilientInventoryHandler : IHandle<CheckInventory> {
    public InventoryStatus Handle(CheckInventory query) {
        // Execution flow:
        // 1. Timeout wraps the actual call
        // 2. Circuit breaker tracks failures
        // 3. Retry handles transient failures
        // 4. Fallback provides last resort
        // 5. Everything is logged
        
        return inventoryService.Check(query);
    }
}

// Conditional policies based on context
[ConditionalPolicy(typeof(PeakHoursPolicy), Condition = nameof(IsPeakHours))]
[ConditionalPolicy(typeof(StandardPolicy), Condition = nameof(IsStandardHours))]
public class AdaptiveHandler : IHandle<ProcessOrder> {
    public OrderProcessed Handle(ProcessOrder cmd) {
        return orderProcessor.Process(cmd);
    }
    
    private bool IsPeakHours() => DateTime.Now.Hour >= 9 && DateTime.Now.Hour <= 17;
    private bool IsStandardHours() => !IsPeakHours();
}
```

### Bulkhead Isolation

```csharp{
title: "Bulkhead Pattern"
description: "Isolate resources to prevent total system failure"
framework: "NET8"
category: "Resilience"
difficulty: "ADVANCED"
tags: ["Bulkhead", "Isolation", "Resilience"]
nugetPackages: ["Whizbang.Core"]
filename: "BulkheadExamples.cs"
showLineNumbers: true
usingStatements: ["Whizbang", "System"]
}
// Limit concurrent executions
[Bulkhead(
    MaxConcurrency = 10,
    MaxQueueLength = 100
)]
public class ThrottledHandler : IHandle<HighLoadOperation> {
    public Result Handle(HighLoadOperation cmd) {
        // Only 10 concurrent executions allowed
        // Up to 100 can queue, rest rejected immediately
        return service.Execute(cmd);
    }
}

// Separate bulkheads for different operations
[Bulkhead(Name = "critical", MaxConcurrency = 20)]
public class CriticalHandler : IHandle<CriticalOperation> {
    public Result Handle(CriticalOperation cmd) {
        return criticalService.Execute(cmd);
    }
}

[Bulkhead(Name = "standard", MaxConcurrency = 5)]
public class StandardHandler : IHandle<StandardOperation> {
    public Result Handle(StandardOperation cmd) {
        return standardService.Execute(cmd);
    }
}
```

### Rate Limiting

```csharp{
title: "Rate Limiting"
description: "Control the rate of operations to prevent overload"
framework: "NET8"
category: "Resilience"
difficulty: "INTERMEDIATE"
tags: ["Rate Limiting", "Throttling", "Resilience"]
nugetPackages: ["Whizbang.Core"]
filename: "RateLimitExamples.cs"
showLineNumbers: true
usingStatements: ["Whizbang", "System"]
}
// Fixed window rate limiting
[RateLimit(
    Permits = 100,
    Window = "1m"  // 100 requests per minute
)]
public class RateLimitedHandler : IHandle<ApiCall> {
    public ApiResponse Handle(ApiCall cmd) {
        return api.Call(cmd);
    }
}

// Sliding window rate limiting
[RateLimit(
    Permits = 1000,
    Window = "1h",
    Mode = "sliding"
)]
public class SlidingWindowHandler : IHandle<BulkOperation> {
    public BulkResult Handle(BulkOperation cmd) {
        return bulkService.Process(cmd);
    }
}

// Token bucket rate limiting
[RateLimit(
    Mode = "token-bucket",
    Capacity = 100,
    RefillRate = 10,      // 10 tokens per second
    RefillInterval = "1s"
)]
public class TokenBucketHandler : IHandle<StreamingOperation> {
    public StreamResult Handle(StreamingOperation cmd) {
        return streamService.Process(cmd);
    }
}
```

## Custom Policies

### Creating Custom Policies

```csharp{
title: "Custom Policy Implementation"
description: "Build your own resilience policies"
framework: "NET8"
category: "Resilience"
difficulty: "ADVANCED"
tags: ["Custom Policies", "Extensibility"]
nugetPackages: ["Whizbang.Core"]
filename: "CustomPolicyExamples.cs"
showLineNumbers: true
usingStatements: ["Whizbang", "System"]
}
// Define custom policy attribute
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public class CacheAsideAttribute : PolicyAttribute {
    public int DurationSeconds { get; set; } = 300;
    public string CacheKey { get; set; }
    
    public override IPolicy CreatePolicy() {
        return new CacheAsidePolicy(DurationSeconds, CacheKey);
    }
}

// Implement the policy
public class CacheAsidePolicy : IPolicy {
    private readonly int _durationSeconds;
    private readonly string _cacheKey;
    
    public async Task<T> ExecuteAsync<T>(
        Func<Task<T>> action,
        PolicyContext context) {
        
        // Try cache first
        var cached = await cache.GetAsync<T>(_cacheKey);
        if (cached != null) {
            return cached;
        }
        
        // Execute action
        var result = await action();
        
        // Cache result
        await cache.SetAsync(_cacheKey, result, _durationSeconds);
        
        return result;
    }
}

// Use custom policy
[CacheAside(DurationSeconds = 600, CacheKey = "products")]
public class ProductHandler : IHandle<GetProducts> {
    public Products Handle(GetProducts query) {
        return productService.GetAll();
    }
}
```

### Policy Context and Telemetry

```csharp{
title: "Policy Context and Observability"
description: "Track and monitor policy execution"
framework: "NET8"
category: "Resilience"
difficulty: "ADVANCED"
tags: ["Telemetry", "Monitoring", "Context"]
nugetPackages: ["Whizbang.Core"]
filename: "PolicyTelemetry.cs"
showLineNumbers: true
usingStatements: ["Whizbang", "System"]
}
// Policy with detailed telemetry
[Retry(3, 
    OnRetry = nameof(LogRetry),
    OnSuccess = nameof(LogSuccess),
    OnFailure = nameof(LogFailure)
)]
public class ObservableHandler : IHandle<CriticalOperation> {
    private readonly ILogger _logger;
    private readonly IMetrics _metrics;
    
    public Result Handle(CriticalOperation cmd) {
        return service.Execute(cmd);
    }
    
    private void LogRetry(RetryContext context) {
        _logger.Warning("Retry {Attempt} after {Delay}ms: {Error}",
            context.AttemptNumber,
            context.Delay.TotalMilliseconds,
            context.LastException?.Message);
        
        _metrics.Increment("handler.retries", 
            tags: new { handler = nameof(ObservableHandler) });
    }
    
    private void LogSuccess(PolicyContext context) {
        _logger.Information("Operation succeeded after {Attempts} attempts",
            context.Attempts);
        
        _metrics.RecordDuration("handler.duration", 
            context.Duration,
            tags: new { status = "success" });
    }
    
    private void LogFailure(PolicyContext context) {
        _logger.Error("Operation failed after {Attempts} attempts: {Error}",
            context.Attempts,
            context.LastException?.Message);
        
        _metrics.Increment("handler.failures",
            tags: new { handler = nameof(ObservableHandler) });
    }
}
```

## Testing Policies

```csharp{
title: "Testing Resilience Policies"
description: "Verify policy behavior under various failure scenarios"
framework: "NET8"
category: "Testing"
difficulty: "INTERMEDIATE"
tags: ["Testing", "Resilience", "Policies"]
nugetPackages: ["Whizbang.Core", "xUnit"]
filename: "PolicyTests.cs"
showLineNumbers: true
usingStatements: ["Whizbang.Testing", "Xunit"]
}
[Fact]
public async Task RetryPolicy_RetriesOnTransientFailure() {
    // Arrange
    var test = await Whizbang.Test<OrderHandler>()
        .WithPolicy<RetryPolicy>()
        .SimulateFailures(2)  // Fail twice, then succeed
        .Given(new CreateOrder { ... });
    
    // Act
    var result = await test.WhenHandled();
    
    // Assert
    result.Should().BeSuccess();
    test.Policy<RetryPolicy>()
        .Should().HaveRetried(2)
        .WithDelays("100ms", "200ms");
}

[Fact]
public async Task CircuitBreaker_OpensAfterThreshold() {
    // Arrange
    var test = await Whizbang.Test<ServiceHandler>()
        .WithPolicy<CircuitBreakerPolicy>();
    
    // Act - Trigger failures
    for (int i = 0; i < 5; i++) {
        await test.SimulateFailure()
            .WhenHandled(new CallService { ... });
    }
    
    // Assert - Circuit should be open
    test.Policy<CircuitBreakerPolicy>()
        .Should().BeOpen()
        .For("30s");
    
    // Further calls should fail immediately
    await test.WhenHandled(new CallService { ... })
        .Should().FailImmediately()
        .WithException<CircuitBreakerOpenException>();
}

[Fact]
public async Task Fallback_ProvidesAlternativeValue() {
    // Arrange
    var test = await Whizbang.Test<DataHandler>()
        .WithPolicy<FallbackPolicy>()
        .SimulateFailure();
    
    // Act
    var result = await test.WhenHandled(new GetData { ... });
    
    // Assert
    result.Should().BeFromFallback();
    test.Policy<FallbackPolicy>()
        .Should().HaveExecutedFallback()
        .WithValue("DefaultData");
}
```

## Best Practices

### Do's

✅ **Layer policies appropriately**
```csharp
[Retry(3)]           // Inner - handles transient failures
[CircuitBreaker(5)]  // Middle - prevents cascading failures
[Timeout(10)]        // Outer - ensures bounded execution time
```

✅ **Use specific exception handling**
```csharp
[Retry(3, RetryOn = new[] { typeof(TransientException) })]
```

✅ **Monitor and log policy actions**
```csharp
[Retry(3, OnRetry = nameof(LogRetry))]
```

✅ **Test failure scenarios**
```csharp
await test.SimulateFailures(3).WhenHandled();
```

### Don'ts

❌ **Don't retry non-idempotent operations**
```csharp
// Bad: Payment might be charged multiple times
[Retry(3)]
public PaymentCharged ChargePayment(ChargeCard cmd)
```

❌ **Don't set timeouts shorter than retries**
```csharp
// Bad: Timeout will trigger before retries complete
[Retry(3, DelayMs = 5000)]
[Timeout(Seconds = 10)]
```

❌ **Don't ignore circuit breaker state**
```csharp
// Bad: No monitoring of circuit breaker health
[CircuitBreaker(5)]
// Should add telemetry to track circuit state
```

## Real-World Examples

### E-Commerce Order Processing

```csharp{
title: "E-Commerce Resilience Pattern"
description: "Complete resilience strategy for order processing"
framework: "NET8"
category: "Real World"
difficulty: "ADVANCED"
tags: ["E-Commerce", "Order Processing", "Resilience"]
nugetPackages: ["Whizbang.Core"]
filename: "ECommerceResilience.cs"
showLineNumbers: true
usingStatements: ["Whizbang", "System"]
}
// Payment processing with comprehensive resilience
[Retry(3, Backoff = "exponential", DelayMs = 1000)]
[CircuitBreaker(Threshold = 10, Duration = "60s")]
[Timeout(Seconds = 30)]
[Fallback(typeof(QueuePaymentForManualProcessing))]
[Logged]
[Metered]
public class PaymentProcessor : IHandle<ProcessPayment> {
    public PaymentProcessed Handle(ProcessPayment cmd, IPaymentGateway gateway) {
        // This is protected by:
        // - 3 retries with exponential backoff
        // - Circuit breaker to prevent hammering failed gateway
        // - 30 second timeout to prevent hanging
        // - Fallback to queue for manual processing
        // - Full logging and metrics
        
        var result = gateway.ChargeCard(
            cmd.CardNumber,
            cmd.Amount,
            cmd.Currency
        );
        
        return new PaymentProcessed(result.TransactionId, result.Status);
    }
}

// Inventory check with caching fallback
[CircuitBreaker(FailureRate = 0.5, SamplingDuration = "30s")]
[Timeout(Seconds = 5)]
[Fallback(typeof(CachedInventoryChecker))]
public class LiveInventoryChecker : IHandle<CheckInventory> {
    public InventoryStatus Handle(CheckInventory query) {
        return inventoryService.GetRealTimeStatus(query.ProductIds);
    }
}

// Order fulfillment saga with resilience
[Saga]
[Retry(5, Backoff = "linear", DelayMs = 2000)]
[Timeout(Seconds = 120)]
public class OrderFulfillmentSaga : IHandle<OrderPlaced> {
    public async Task<SagaResult> Handle(OrderPlaced @event) {
        // Each step has its own resilience policies
        await Send(new ReserveInventory(@event.OrderId))
            .WithRetry(3)
            .WithTimeout(10);
        
        await Send(new ProcessPayment(@event.OrderId))
            .WithRetry(5)
            .WithCircuitBreaker()
            .WithFallback(new QueuePayment(@event.OrderId));
        
        await Send(new ShipOrder(@event.OrderId))
            .WithRetry(3)
            .WithTimeout(30);
        
        return SagaResult.Completed();
    }
}
```

## Next Steps

- Learn about **[Aspect-Oriented Handlers](aspect-oriented-handlers.md)** for more aspects
- Explore **[Testing Strategies](/docs/advanced/testing-strategies)** for policy testing
- Review **[Distributed Messaging](distributed-messaging.md)** for cross-service resilience
- See **[Production Deployment](/docs/deployment/production)** for monitoring setup