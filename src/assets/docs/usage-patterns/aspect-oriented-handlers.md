---
title: Aspect-Oriented Handlers
category: Usage Patterns
order: 8
tags: aspects, aop, cross-cutting-concerns, handlers, decorators
description: Implementing cross-cutting concerns through aspect-oriented programming with source generators
---

# Aspect-Oriented Handlers

## Overview

Aspect-Oriented Programming (AOP) in Whizbang allows you to cleanly separate cross-cutting concerns from your business logic. Through source generators and declarative attributes, you can add logging, caching, validation, authorization, and other behaviors without cluttering your handler code.

## Core Concepts

### Aspects vs Traditional Approaches

Traditional approach with manual cross-cutting concerns:
```csharp
// ❌ Traditional: Business logic mixed with infrastructure concerns
public class OrderHandler {
    private readonly ILogger _logger;
    private readonly ICache _cache;
    private readonly IMetrics _metrics;
    private readonly IValidator _validator;
    
    public async Task<Result> Handle(CreateOrder cmd) {
        // Validation
        var validationResult = _validator.Validate(cmd);
        if (!validationResult.IsValid) {
            _logger.Warning("Validation failed: {Errors}", validationResult.Errors);
            return Result.Failure(validationResult.Errors);
        }
        
        // Logging
        _logger.Information("Processing order for customer {CustomerId}", cmd.CustomerId);
        var stopwatch = Stopwatch.StartNew();
        
        try {
            // Check cache
            var cacheKey = $"order:{cmd.CustomerId}";
            var cached = await _cache.GetAsync<Order>(cacheKey);
            if (cached != null) {
                _logger.Debug("Cache hit for {CacheKey}", cacheKey);
                return Result.Success(cached);
            }
            
            // FINALLY: Actual business logic (buried in infrastructure)
            var order = CreateOrder(cmd);
            
            // Update cache
            await _cache.SetAsync(cacheKey, order);
            
            // Metrics
            _metrics.Increment("orders.created");
            _metrics.RecordDuration("order.processing", stopwatch.Elapsed);
            
            _logger.Information("Order {OrderId} created successfully", order.Id);
            return Result.Success(order);
        }
        catch (Exception ex) {
            _logger.Error(ex, "Failed to create order");
            _metrics.Increment("orders.failed");
            throw;
        }
    }
}
```

Whizbang approach with aspects:
```csharp
// ✅ Whizbang: Pure business logic with declarative aspects
[Validated]
[Logged]
[Cached(Duration = "5m")]
[Timed]
[Metered("orders")]
public class OrderHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd) {
        // ONLY business logic - clean and focused
        var order = CreateOrder(cmd);
        return new OrderCreated(order.Id, order.Total);
    }
}
```

## Built-in Aspects

### Logging Aspect

```csharp{
title: "Logging Aspect"
description: "Automatic structured logging for handlers"
framework: "NET8"
category: "Aspects"
difficulty: "BEGINNER"
tags: ["Logging", "Observability", "Aspects"]
nugetPackages: ["Whizbang.Core"]
filename: "LoggingAspect.cs"
showLineNumbers: true
highlightLines: [1, 2, 3]
usingStatements: ["Whizbang", "System"]
}
// Basic logging
[Logged]
public class OrderHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd) {
        // Automatically logs:
        // - Handler execution start
        // - Input parameters (redacted sensitive data)
        // - Execution duration
        // - Success/failure status
        // - Return value summary
        return new OrderCreated(cmd.OrderId);
    }
}

// Detailed logging with custom levels
[Logged(
    Level = LogLevel.Debug,
    LogInputs = true,
    LogOutputs = true,
    LogDuration = true
)]
public class DetailedHandler : IHandle<ComplexOperation> {
    public Result Handle(ComplexOperation cmd) {
        return ProcessComplex(cmd);
    }
}

// Conditional logging
[Logged(
    OnlyOnError = true,
    IncludeStackTrace = true,
    MaxDepth = 3  // How deep to serialize objects
)]
public class ErrorFocusedHandler : IHandle<RiskyOperation> {
    public Result Handle(RiskyOperation cmd) {
        // Only logs when exception occurs
        return PerformRiskyOperation(cmd);
    }
}

// Custom log enrichment
[Logged(Enricher = nameof(EnrichLog))]
public class EnrichedHandler : IHandle<BusinessOperation> {
    public Result Handle(BusinessOperation cmd) {
        return Process(cmd);
    }
    
    private void EnrichLog(LogContext context, BusinessOperation cmd) {
        context.AddProperty("TenantId", cmd.TenantId);
        context.AddProperty("Region", GetRegion(cmd));
        context.AddProperty("Priority", cmd.Priority);
    }
}
```

### Validation Aspect

```csharp{
title: "Validation Aspect"
description: "Automatic input validation using FluentValidation or DataAnnotations"
framework: "NET8"
category: "Aspects"
difficulty: "BEGINNER"
tags: ["Validation", "Input Validation", "Aspects"]
nugetPackages: ["Whizbang.Core"]
filename: "ValidationAspect.cs"
showLineNumbers: true
highlightLines: [1, 14, 27]
usingStatements: ["Whizbang", "System", "System.ComponentModel.DataAnnotations"]
}
// Automatic validation with conventions
[Validated]
public class CreateUserHandler : IHandle<CreateUser> {
    public UserCreated Handle(CreateUser cmd) {
        // Validation happens before this executes
        // Looks for CreateUserValidator automatically
        return new UserCreated(cmd.Email);
    }
}

// Explicit validator specification
[Validated(Validator = typeof(CustomOrderValidator))]
public class OrderHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd) {
        return new OrderCreated(cmd.OrderId);
    }
}

// Inline validation rules
[Validated(
    Rules = new[] {
        "Amount > 0",
        "Currency != null",
        "CustomerId != Guid.Empty"
    }
)]
public class PaymentHandler : IHandle<ProcessPayment> {
    public PaymentProcessed Handle(ProcessPayment cmd) {
        return new PaymentProcessed(cmd.Amount);
    }
}

// Combining with FluentValidation
public class CreateOrderValidator : AbstractValidator<CreateOrder> {
    public CreateOrderValidator() {
        RuleFor(x => x.CustomerId).NotEmpty();
        RuleFor(x => x.Items).NotEmpty()
            .Must(items => items.All(i => i.Quantity > 0));
        RuleFor(x => x.ShippingAddress).NotEmpty()
            .MaximumLength(500);
    }
}

[Validated] // Automatically uses CreateOrderValidator
public class ValidatedOrderHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd) {
        return new OrderCreated(cmd.OrderId);
    }
}
```

### Caching Aspect

```csharp{
title: "Caching Aspect"
description: "Automatic result caching with flexible cache keys"
framework: "NET8"
category: "Aspects"
difficulty: "INTERMEDIATE"
tags: ["Caching", "Performance", "Aspects"]
nugetPackages: ["Whizbang.Core"]
filename: "CachingAspect.cs"
showLineNumbers: true
highlightLines: [1, 12, 24, 36]
usingStatements: ["Whizbang", "System"]
}
// Simple caching with duration
[Cached(Duration = "5m")]
public class ProductHandler : IHandle<GetProduct> {
    public Product Handle(GetProduct query) {
        // Result cached for 5 minutes
        // Cache key auto-generated from query properties
        return database.GetProduct(query.ProductId);
    }
}

// Custom cache key generation
[Cached(
    Duration = "10m",
    KeyGenerator = nameof(GenerateCacheKey)
)]
public class CustomKeyHandler : IHandle<ComplexQuery> {
    public QueryResult Handle(ComplexQuery query) {
        return ExecuteComplexQuery(query);
    }
    
    private string GenerateCacheKey(ComplexQuery query) {
        return $"complex:{query.TenantId}:{query.FilterHash}";
    }
}

// Sliding expiration cache
[Cached(
    Duration = "1h",
    Mode = "sliding",  // Resets on each access
    CacheNullResults = false
)]
public class SlidingCacheHandler : IHandle<GetUserPreferences> {
    public UserPreferences Handle(GetUserPreferences query) {
        return userService.GetPreferences(query.UserId);
    }
}

// Conditional caching
[Cached(
    Duration = "30m",
    Condition = nameof(ShouldCache),
    InvalidateOn = new[] { typeof(UserUpdated), typeof(UserDeleted) }
)]
public class ConditionalCacheHandler : IHandle<GetUserProfile> {
    public UserProfile Handle(GetUserProfile query) {
        return userService.GetProfile(query.UserId);
    }
    
    private bool ShouldCache(GetUserProfile query) {
        // Only cache for non-admin users
        return !query.IsAdmin;
    }
}

// Distributed cache
[Cached(
    Duration = "1h",
    CacheType = "distributed",  // Redis, Memcached, etc.
    SerializationFormat = "msgpack"
)]
public class DistributedCacheHandler : IHandle<GetOrderHistory> {
    public OrderHistory Handle(GetOrderHistory query) {
        return orderService.GetHistory(query.CustomerId);
    }
}
```

### Authorization Aspect

```csharp{
title: "Authorization Aspect"
description: "Declarative security with fine-grained access control"
framework: "NET8"
category: "Aspects"
difficulty: "INTERMEDIATE"
tags: ["Authorization", "Security", "Aspects"]
nugetPackages: ["Whizbang.Core"]
filename: "AuthorizationAspect.cs"
showLineNumbers: true
highlightLines: [1, 10, 19, 30]
usingStatements: ["Whizbang", "System"]
}
// Role-based authorization
[Authorized(Roles = "Admin,Manager")]
public class AdminHandler : IHandle<AdminCommand> {
    public Result Handle(AdminCommand cmd) {
        // Only admins and managers can execute
        return PerformAdminAction(cmd);
    }
}

// Policy-based authorization
[Authorized(Policy = "CanEditOrders")]
public class OrderEditHandler : IHandle<EditOrder> {
    public OrderUpdated Handle(EditOrder cmd) {
        // Policy evaluated before execution
        return UpdateOrder(cmd);
    }
}

// Resource-based authorization
[Authorized(Resource = nameof(GetOrderResource))]
public class OrderAccessHandler : IHandle<GetOrder> {
    public Order Handle(GetOrder query) {
        return orderService.Get(query.OrderId);
    }
    
    private object GetOrderResource(GetOrder query) {
        return new { Type = "Order", Id = query.OrderId };
    }
}

// Custom authorization logic
[Authorized(Authorizer = typeof(CustomOrderAuthorizer))]
public class CustomAuthHandler : IHandle<SensitiveOperation> {
    public Result Handle(SensitiveOperation cmd) {
        return ExecuteSensitive(cmd);
    }
}

public class CustomOrderAuthorizer : IAuthorizer<SensitiveOperation> {
    public Task<bool> AuthorizeAsync(SensitiveOperation cmd, IUser user) {
        // Custom authorization logic
        if (user.IsInRole("Admin")) return Task.FromResult(true);
        if (cmd.OwnerId == user.Id) return Task.FromResult(true);
        if (user.HasPermission("sensitive.execute")) return Task.FromResult(true);
        
        return Task.FromResult(false);
    }
}
```

### Transactional Aspect

```csharp{
title: "Transactional Aspect"
description: "Automatic transaction management with various isolation levels"
framework: "NET8"
category: "Aspects"
difficulty: "INTERMEDIATE"
tags: ["Transactions", "Database", "Aspects"]
nugetPackages: ["Whizbang.Core"]
filename: "TransactionalAspect.cs"
showLineNumbers: true
highlightLines: [1, 11, 22, 35]
usingStatements: ["Whizbang", "System", "System.Data"]
}
// Simple transaction
[Transactional]
public class TransferHandler : IHandle<TransferMoney> {
    public TransferCompleted Handle(TransferMoney cmd, IAccountService accounts) {
        // Entire operation wrapped in transaction
        accounts.Debit(cmd.FromAccount, cmd.Amount);
        accounts.Credit(cmd.ToAccount, cmd.Amount);
        return new TransferCompleted(cmd.TransferId);
    }
}

// Transaction with specific isolation level
[Transactional(
    IsolationLevel = IsolationLevel.ReadCommitted,
    Timeout = "30s"
)]
public class OrderHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd) {
        // Executes with ReadCommitted isolation
        return CreateOrderWithInventory(cmd);
    }
}

// Nested transaction support
[Transactional(AllowNested = true)]
public class ParentHandler : IHandle<ParentCommand> {
    public Result Handle(ParentCommand cmd, IWhizbang whizbang) {
        // Start transaction
        var result1 = ProcessFirst(cmd);
        
        // This creates a nested transaction
        var result2 = whizbang.Send(new ChildCommand());
        
        return CombineResults(result1, result2);
    }
}

// Distributed transaction
[Transactional(
    Mode = "distributed",
    Coordinator = "saga"
)]
public class DistributedHandler : IHandle<CrossServiceCommand> {
    public async Task<Result> Handle(CrossServiceCommand cmd) {
        // Coordinates transaction across services
        await orderService.CreateOrder(cmd.Order);
        await inventoryService.ReserveStock(cmd.Items);
        await paymentService.ProcessPayment(cmd.Payment);
        
        return Result.Success();
    }
}
```

### Performance Aspects

```csharp{
title: "Performance Aspects"
description: "Timing, metrics, and performance monitoring"
framework: "NET8"
category: "Aspects"
difficulty: "INTERMEDIATE"
tags: ["Performance", "Metrics", "Monitoring"]
nugetPackages: ["Whizbang.Core"]
filename: "PerformanceAspects.cs"
showLineNumbers: true
highlightLines: [1, 2, 3]
usingStatements: ["Whizbang", "System"]
}
// Comprehensive performance monitoring
[Timed]
[Metered("orders")]
[Traced]
public class MonitoredHandler : IHandle<ProcessOrder> {
    public OrderProcessed Handle(ProcessOrder cmd) {
        // Automatically tracks:
        // - Execution duration (Timed)
        // - Success/failure counts (Metered)
        // - Distributed trace span (Traced)
        return ProcessOrder(cmd);
    }
}

// Detailed timing with percentiles
[Timed(
    RecordPercentiles = new[] { 50, 90, 95, 99 },
    PublishHistogram = true,
    BucketSize = "100ms"
)]
public class DetailedTimingHandler : IHandle<ComplexCalculation> {
    public CalculationResult Handle(ComplexCalculation cmd) {
        return PerformCalculation(cmd);
    }
}

// Custom metrics
[Metered(
    Namespace = "business.orders",
    RecordErrors = true,
    RecordDuration = true,
    Tags = new[] { "region", "customer_type" }
)]
public class MeteredHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd) {
        // Publishes metrics:
        // - business.orders.count
        // - business.orders.errors
        // - business.orders.duration
        // Tagged with region and customer_type
        return CreateOrder(cmd);
    }
}
```

## Custom Aspects

### Creating Custom Aspects

```csharp{
title: "Custom Aspect Implementation"
description: "Build your own aspects for specific concerns"
framework: "NET8"
category: "Aspects"
difficulty: "ADVANCED"
tags: ["Custom Aspects", "Extensibility", "Source Generators"]
nugetPackages: ["Whizbang.Core"]
filename: "CustomAspects.cs"
showLineNumbers: true
usingStatements: ["Whizbang", "System"]
}
// Define custom aspect attribute
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public class AuditedAttribute : AspectAttribute {
    public bool IncludeResult { get; set; } = false;
    public string AuditTable { get; set; } = "AuditLog";
}

// Source generator creates this implementation
[SourceGenerated]
internal class AuditedAspect : IAspect {
    private readonly IAuditService _auditService;
    
    public async Task<T> InterceptAsync<T>(
        AspectContext context,
        Func<Task<T>> next) {
        
        // Before execution
        var auditEntry = new AuditEntry {
            UserId = context.User.Id,
            Operation = context.HandlerName,
            Input = SerializeInput(context.Message),
            Timestamp = DateTime.UtcNow
        };
        
        try {
            // Execute handler
            var result = await next();
            
            // After execution
            auditEntry.Success = true;
            if (context.Attribute.IncludeResult) {
                auditEntry.Output = SerializeOutput(result);
            }
            
            return result;
        }
        catch (Exception ex) {
            auditEntry.Success = false;
            auditEntry.Error = ex.Message;
            throw;
        }
        finally {
            // Always audit
            await _auditService.LogAsync(
                context.Attribute.AuditTable, 
                auditEntry
            );
        }
    }
}

// Use custom aspect
[Audited(IncludeResult = true, AuditTable = "OrderAudits")]
public class AuditedOrderHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd) {
        return new OrderCreated(cmd.OrderId);
    }
}
```

### Aspect Composition

```csharp{
title: "Composing Multiple Aspects"
description: "Combining aspects for comprehensive behavior"
framework: "NET8"
category: "Aspects"
difficulty: "ADVANCED"
tags: ["Aspect Composition", "Ordering", "Dependencies"]
nugetPackages: ["Whizbang.Core"]
filename: "AspectComposition.cs"
showLineNumbers: true
highlightLines: [1, 2, 3, 4, 5, 6]
usingStatements: ["Whizbang", "System"]
}
// Aspects execute in order of declaration
[Logged]                    // 1. Outermost - logs everything
[Timed]                     // 2. Times the entire operation
[Authorized]                // 3. Check authorization
[Validated]                 // 4. Validate inputs
[Transactional]            // 5. Start transaction
[Cached(Duration = "10m")]  // 6. Innermost - check cache first
public class FullyAspectedHandler : IHandle<ComplexQuery> {
    public QueryResult Handle(ComplexQuery query) {
        // Execution flow:
        // → Logging starts
        //   → Timer starts
        //     → Authorization check
        //       → Input validation
        //         → Transaction begins
        //           → Cache check (hit = early return)
        //             → Handler executes
        //           ← Cache stores result
        //         ← Transaction commits
        //       ← Validation complete
        //     ← Authorization complete
        //   ← Timer stops
        // ← Logging ends
        
        return ExecuteComplexQuery(query);
    }
}

// Conditional aspect composition
[ConditionalAspect(typeof(CachedAttribute), Condition = nameof(IsReadOperation))]
[ConditionalAspect(typeof(TransactionalAttribute), Condition = nameof(IsWriteOperation))]
public class AdaptiveHandler : IHandle<DynamicCommand> {
    public Result Handle(DynamicCommand cmd) {
        return ProcessDynamic(cmd);
    }
    
    private bool IsReadOperation(DynamicCommand cmd) => cmd.IsQuery;
    private bool IsWriteOperation(DynamicCommand cmd) => !cmd.IsQuery;
}

// Aspect dependencies
[RequiresAspect(typeof(LoggedAttribute))]  // Must have Logged
public class DependentAuditAttribute : AspectAttribute { }

[Logged]
[DependentAudit]  // OK - Logged is present
public class ValidHandler : IHandle<Command> { }

// [DependentAudit]  // Compile error - Missing required Logged aspect
public class InvalidHandler : IHandle<Command> { }
```

## Testing with Aspects

```csharp{
title: "Testing Aspect Behavior"
description: "Verify aspects work correctly in isolation and composition"
framework: "NET8"
category: "Testing"
difficulty: "INTERMEDIATE"
tags: ["Testing", "Aspects", "Unit Tests"]
nugetPackages: ["Whizbang.Core", "xUnit"]
filename: "AspectTests.cs"
showLineNumbers: true
usingStatements: ["Whizbang.Testing", "Xunit"]
}
[Fact]
public async Task CacheAspect_CachesResult() {
    // Arrange
    var test = await Whizbang.Test<ProductHandler>()
        .WithAspect<CachedAttribute>()
        .Given(new GetProduct { ProductId = "123" });
    
    // Act - First call
    var result1 = await test.WhenHandled();
    
    // Act - Second call
    var result2 = await test.WhenHandled();
    
    // Assert
    Assert.Same(result1, result2);  // Same instance
    test.Aspect<CachedAttribute>()
        .Should().HaveHitCache()
        .OnSecondCall();
    test.Handler.Should().HaveBeenCalledOnce();  // Not twice
}

[Fact]
public async Task ValidationAspect_RejectsInvalidInput() {
    // Arrange
    var test = await Whizbang.Test<CreateUserHandler>()
        .WithAspect<ValidatedAttribute>()
        .Given(new CreateUser { Email = "invalid" });
    
    // Act & Assert
    await test.WhenHandled()
        .Should().FailValidation()
        .WithError("Email", "Invalid email format");
    
    test.Handler.Should().NotHaveBeenCalled();
}

[Fact]
public async Task TransactionalAspect_RollsBackOnError() {
    // Arrange
    var test = await Whizbang.Test<TransferHandler>()
        .WithAspect<TransactionalAttribute>()
        .WithDatabase(db)
        .Given(new TransferMoney { Amount = 100 });
    
    // Act - Force error
    test.Handler.ThrowsOn(2);  // Throw on second operation
    
    // Assert
    await test.WhenHandled()
        .Should().Throw<Exception>();
    
    test.Database.Should().HaveNoChanges();  // Rolled back
    test.Aspect<TransactionalAttribute>()
        .Should().HaveRolledBack();
}

// Test aspect ordering
[Fact]
public async Task Aspects_ExecuteInCorrectOrder() {
    // Arrange
    var test = await Whizbang.Test<FullyAspectedHandler>()
        .WithAllAspects()
        .RecordExecutionOrder();
    
    // Act
    await test.WhenHandled(new ComplexQuery());
    
    // Assert
    test.ExecutionOrder.Should().BeInOrder(
        "LoggedAspect.Before",
        "TimedAspect.Before",
        "AuthorizedAspect.Before",
        "ValidatedAspect.Before",
        "TransactionalAspect.Before",
        "CachedAspect.Before",
        "Handler.Execute",
        "CachedAspect.After",
        "TransactionalAspect.After",
        "ValidatedAspect.After",
        "AuthorizedAspect.After",
        "TimedAspect.After",
        "LoggedAspect.After"
    );
}
```

## Performance Considerations

### Source Generation

```csharp{
title: "Zero-Overhead Aspects via Source Generation"
description: "How source generators eliminate aspect overhead"
framework: "NET8"
category: "Performance"
difficulty: "ADVANCED"
tags: ["Source Generators", "Performance", "Compilation"]
nugetPackages: ["Whizbang.Core"]
filename: "SourceGeneration.cs"
showLineNumbers: true
usingStatements: ["Whizbang", "System"]
}
// What you write
[Logged]
[Cached(Duration = "5m")]
public class UserHandler : IHandle<GetUser> {
    public User Handle(GetUser query) {
        return database.GetUser(query.UserId);
    }
}

// What source generator produces
[SourceGenerated]
internal class UserHandler_Generated : IHandle<GetUser> {
    private readonly UserHandler _inner;
    private readonly ILogger _logger;
    private readonly ICache _cache;
    
    public User Handle(GetUser query) {
        // Inlined logging
        _logger.LogInformation("Executing UserHandler with {UserId}", query.UserId);
        var stopwatch = Stopwatch.StartNew();
        
        try {
            // Inlined caching
            var cacheKey = $"user:{query.UserId}";
            if (_cache.TryGet<User>(cacheKey, out var cached)) {
                _logger.LogDebug("Cache hit for {Key}", cacheKey);
                return cached;
            }
            
            // Call actual handler
            var result = _inner.Handle(query);
            
            // Store in cache
            _cache.Set(cacheKey, result, TimeSpan.FromMinutes(5));
            
            _logger.LogInformation("UserHandler completed in {Duration}ms", 
                stopwatch.ElapsedMilliseconds);
            return result;
        }
        catch (Exception ex) {
            _logger.LogError(ex, "UserHandler failed");
            throw;
        }
    }
}
```

## Best Practices

### Do's

✅ **Use aspects for cross-cutting concerns**
```csharp
[Logged]
[Validated]
[Cached]
```

✅ **Keep handlers focused on business logic**
```csharp
public OrderCreated Handle(CreateOrder cmd) {
    // Only business logic, no infrastructure
    return CreateOrder(cmd);
}
```

✅ **Order aspects correctly**
```csharp
[Logged]        // Outermost - see everything
[Authorized]    // Check auth before validation
[Validated]     // Validate before execution
[Transactional] // Wrap actual work
```

✅ **Test aspects in isolation**
```csharp
await Test<Handler>()
    .WithAspect<CachedAttribute>()
    .VerifyBehavior();
```

### Don'ts

❌ **Don't mix aspects with manual concerns**
```csharp
[Logged]
public Result Handle(Command cmd) {
    _logger.Log("Starting");  // Don't - redundant with aspect
}
```

❌ **Don't create aspects for business logic**
```csharp
[CalculateTax]  // Bad - business logic not cross-cutting
```

❌ **Don't ignore aspect overhead in hot paths**
```csharp
[Logged(LogInputs = true)]  // Careful with large objects
public Result Handle(LargeDataQuery query)
```

## Real-World Example

```csharp{
title: "Complete E-Commerce Handler with Aspects"
description: "Production-ready handler showcasing multiple aspects"
framework: "NET8"
category: "Real World"
difficulty: "ADVANCED"
tags: ["E-Commerce", "Production", "Complete Example"]
nugetPackages: ["Whizbang.Core"]
filename: "ECommerceHandler.cs"
showLineNumbers: true
usingStatements: ["Whizbang", "System"]
}
// Order processing with comprehensive aspects
[Logged(Level = LogLevel.Information)]
[Timed(PublishHistogram = true)]
[Metered("orders.checkout")]
[Authorized(Policy = "CanCreateOrders")]
[Validated]
[RateLimited(Permits = 100, Window = "1m")]
[Transactional(IsolationLevel = IsolationLevel.ReadCommitted)]
[Retry(3, Backoff = "exponential")]
[CircuitBreaker(Threshold = 10, Duration = "30s")]
[Traced(IncludeHeaders = true)]
public class CheckoutHandler : IHandle<Checkout> {
    public CheckoutCompleted Handle(Checkout cmd, 
        IInventoryService inventory,
        IPaymentService payment,
        IShippingService shipping) {
        
        // Pure business logic - all concerns handled by aspects
        
        // Reserve inventory
        var reservation = inventory.Reserve(cmd.Items);
        
        // Process payment
        var transaction = payment.Charge(
            cmd.PaymentMethod, 
            cmd.Total
        );
        
        // Create shipment
        var shipment = shipping.CreateShipment(
            cmd.ShippingAddress,
            cmd.Items
        );
        
        // Return completed checkout
        return new CheckoutCompleted {
            OrderId = Guid.NewGuid(),
            ReservationId = reservation.Id,
            TransactionId = transaction.Id,
            ShipmentId = shipment.Id,
            EstimatedDelivery = shipment.EstimatedDelivery
        };
    }
}

// Query handler with read-optimized aspects
[Logged(OnlyOnError = true)]
[Cached(Duration = "15m", Mode = "sliding")]
[Compressed]
[Traced]
public class OrderHistoryHandler : IHandle<GetOrderHistory> {
    public OrderHistory Handle(GetOrderHistory query) {
        // Cached and compressed for performance
        return orderService.GetHistory(
            query.CustomerId,
            query.StartDate,
            query.EndDate
        );
    }
}
```

## Next Steps

- Explore **[Progressive Enhancement](progressive-enhancement.md)** for scaling patterns
- Learn about **[Policy Composition](policy-composition.md)** for resilience
- Review **[Testing Strategies](/docs/advanced/testing-strategies)** for aspect testing
- See **[Source Generators](/docs/advanced/source-generators)** for implementation details