---
title: Hooks and Middleware
version: 1.0.0
category: Extensibility
order: 1
description: >-
  Pipeline behaviors for cross-cutting concerns - logging, validation, retry,
  caching, and custom pre/post processing
tags: >-
  extensibility, pipeline-behavior, middleware, hooks, cross-cutting-concerns,
  aop
codeReferences:
  - src/Whizbang.Core/Pipeline/IPipelineBehavior.cs
---

# Hooks and Middleware

**Pipeline behaviors** enable cross-cutting concerns without modifying business logic. Behaviors intercept messages before/after receptor execution, allowing logging, validation, retry logic, caching, and other concerns to be injected declaratively.

## Why Pipeline Behaviors?

**Separate cross-cutting concerns from business logic**:

| Without Behaviors | With Behaviors | Benefit |
|-------------------|----------------|---------|
| **Logging in every receptor** | Single logging behavior | DRY principle |
| **Validation scattered** | Centralized validation behavior | Consistency |
| **Retry logic duplicated** | Reusable retry behavior | Maintainability |
| **Caching per-handler** | Generic caching behavior | Reduced complexity |
| **Timing/metrics manual** | Automatic timing behavior | Complete coverage |

**Use Cases**:
- ✅ **Logging** - Structured logging for all messages
- ✅ **Validation** - Input validation before processing
- ✅ **Retry Logic** - Automatic retry on transient failures
- ✅ **Caching** - Response caching for idempotent queries
- ✅ **Performance Metrics** - Timing and throughput tracking
- ✅ **Authorization** - Permission checks
- ✅ **Transaction Management** - Automatic transaction boundaries
- ✅ **Error Handling** - Centralized exception handling

---

## Architecture

### Pipeline Execution Flow

```
IDispatcher.SendAsync(command)
  │
  │ 1. Create pipeline
  ▼
┌────────────────────────────────────────────────────────┐
│  Pipeline Chain (behaviors + receptor)                 │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │  LoggingBehavior                                 │ │
│  │  ├─ Before: Log request                          │ │
│  │  ├─ Call next() → ValidationBehavior             │ │
│  │  └─ After: Log response                          │ │
│  └──────────────────────────────────────────────────┘ │
│                  │                                      │
│                  ▼                                      │
│  ┌──────────────────────────────────────────────────┐ │
│  │  ValidationBehavior                              │ │
│  │  ├─ Before: Validate request                     │ │
│  │  ├─ Call next() → RetryBehavior                  │ │
│  │  └─ After: No post-processing                    │ │
│  └──────────────────────────────────────────────────┘ │
│                  │                                      │
│                  ▼                                      │
│  ┌──────────────────────────────────────────────────┐ │
│  │  RetryBehavior                                   │ │
│  │  ├─ Before: No pre-processing                    │ │
│  │  ├─ Call next() → OrderReceptor (with retry)     │ │
│  │  └─ After: No post-processing                    │ │
│  └──────────────────────────────────────────────────┘ │
│                  │                                      │
│                  ▼                                      │
│  ┌──────────────────────────────────────────────────┐ │
│  │  OrderReceptor.HandleAsync()                     │ │
│  │  └─ Business logic execution                     │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
  │
  │ 2. Return result
  ▼
Response
```

---

## IPipelineBehavior Interface

### Definition

```csharp
public interface IPipelineBehavior<in TRequest, TResponse> {
  Task<TResponse> Handle(
    TRequest request,
    Func<Task<TResponse>> next,
    CancellationToken cancellationToken = default
  );
}
```

**Parameters**:
- `request` - The message being processed (command or query)
- `next` - Delegate to invoke next behavior or receptor
- `cancellationToken` - Cancellation token

**Return**: Response from receptor (potentially modified by behavior)

### Base Class

```csharp
public abstract class PipelineBehavior<TRequest, TResponse>
  : IPipelineBehavior<TRequest, TResponse> {

  public abstract Task<TResponse> Handle(
    TRequest request,
    Func<Task<TResponse>> next,
    CancellationToken cancellationToken = default
  );

  protected async Task<TResponse> ExecuteNextAsync(Func<Task<TResponse>> next) {
    return await next();
  }
}
```

---

## Built-In Behaviors

### 1. Logging Behavior

```csharp
using Microsoft.Extensions.Logging;
using Whizbang.Core.Pipeline;

public class LoggingBehavior<TRequest, TResponse>
  : IPipelineBehavior<TRequest, TResponse> {

  private readonly ILogger<LoggingBehavior<TRequest, TResponse>> _logger;

  public LoggingBehavior(ILogger<LoggingBehavior<TRequest, TResponse>> logger) {
    _logger = logger;
  }

  public async Task<TResponse> Handle(
    TRequest request,
    Func<Task<TResponse>> next,
    CancellationToken cancellationToken
  ) {
    var requestName = typeof(TRequest).Name;
    var requestId = Guid.NewGuid();

    // Before: Log request
    _logger.LogInformation(
      "Processing {RequestName} ({RequestId}): {@Request}",
      requestName,
      requestId,
      request
    );

    try {
      // Execute next behavior or receptor
      var response = await next();

      // After: Log success
      _logger.LogInformation(
        "Completed {RequestName} ({RequestId}): {@Response}",
        requestName,
        requestId,
        response
      );

      return response;
    } catch (Exception ex) {
      // After: Log failure
      _logger.LogError(
        ex,
        "Failed {RequestName} ({RequestId}): {Error}",
        requestName,
        requestId,
        ex.Message
      );
      throw;
    }
  }
}
```

**Registration**:
```csharp
builder.Services.AddTransient(
  typeof(IPipelineBehavior<,>),
  typeof(LoggingBehavior<,>)
);
```

### 2. Validation Behavior

```csharp
using FluentValidation;
using Whizbang.Core.Pipeline;

public class ValidationBehavior<TRequest, TResponse>
  : IPipelineBehavior<TRequest, TResponse> {

  private readonly IEnumerable<IValidator<TRequest>> _validators;

  public ValidationBehavior(IEnumerable<IValidator<TRequest>> validators) {
    _validators = validators;
  }

  public async Task<TResponse> Handle(
    TRequest request,
    Func<Task<TResponse>> next,
    CancellationToken cancellationToken
  ) {
    // No validators registered - skip validation
    if (!_validators.Any()) {
      return await next();
    }

    // Validate request
    var context = new ValidationContext<TRequest>(request);
    var validationResults = await Task.WhenAll(
      _validators.Select(v => v.ValidateAsync(context, cancellationToken))
    );

    var failures = validationResults
      .SelectMany(r => r.Errors)
      .Where(f => f != null)
      .ToList();

    if (failures.Any()) {
      throw new ValidationException(failures);
    }

    // Validation passed - continue
    return await next();
  }
}
```

**Registration**:
```csharp
// Register validators
builder.Services.AddValidatorsFromAssemblyContaining<CreateOrderValidator>();

// Register behavior
builder.Services.AddTransient(
  typeof(IPipelineBehavior<,>),
  typeof(ValidationBehavior<,>)
);
```

### 3. Retry Behavior

```csharp
using Polly;
using Whizbang.Core.Pipeline;

public class RetryBehavior<TRequest, TResponse>
  : IPipelineBehavior<TRequest, TResponse> {

  private readonly ILogger<RetryBehavior<TRequest, TResponse>> _logger;

  public RetryBehavior(ILogger<RetryBehavior<TRequest, TResponse>> logger) {
    _logger = logger;
  }

  public async Task<TResponse> Handle(
    TRequest request,
    Func<Task<TResponse>> next,
    CancellationToken cancellationToken
  ) {
    // Define retry policy
    var retryPolicy = Policy
      .Handle<DbException>()  // Transient database failures
      .Or<HttpRequestException>()  // Transient HTTP failures
      .WaitAndRetryAsync(
        retryCount: 3,
        sleepDurationProvider: retryAttempt =>
          TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)),  // Exponential backoff
        onRetry: (exception, timeSpan, retryCount, context) => {
          _logger.LogWarning(
            exception,
            "Retry {RetryCount} for {RequestName} after {Delay}s",
            retryCount,
            typeof(TRequest).Name,
            timeSpan.TotalSeconds
          );
        }
      );

    // Execute with retry
    return await retryPolicy.ExecuteAsync(async () => await next());
  }
}
```

### 4. Caching Behavior

```csharp
using Microsoft.Extensions.Caching.Memory;
using Whizbang.Core.Pipeline;

public class CachingBehavior<TRequest, TResponse>
  : IPipelineBehavior<TRequest, TResponse>
  where TRequest : ICacheableQuery {  // Marker interface

  private readonly IMemoryCache _cache;
  private readonly ILogger<CachingBehavior<TRequest, TResponse>> _logger;

  public CachingBehavior(
    IMemoryCache cache,
    ILogger<CachingBehavior<TRequest, TResponse>> logger
  ) {
    _cache = cache;
    _logger = logger;
  }

  public async Task<TResponse> Handle(
    TRequest request,
    Func<Task<TResponse>> next,
    CancellationToken cancellationToken
  ) {
    var cacheKey = $"{typeof(TRequest).Name}:{request.GetCacheKey()}";

    // Check cache
    if (_cache.TryGetValue<TResponse>(cacheKey, out var cachedResponse)) {
      _logger.LogDebug("Cache hit for {CacheKey}", cacheKey);
      return cachedResponse!;
    }

    // Cache miss - execute handler
    _logger.LogDebug("Cache miss for {CacheKey}", cacheKey);
    var response = await next();

    // Store in cache
    var cacheOptions = new MemoryCacheEntryOptions {
      AbsoluteExpirationRelativeToNow = request.GetCacheDuration()
    };

    _cache.Set(cacheKey, response, cacheOptions);
    return response;
  }
}

// Marker interface for cacheable queries
public interface ICacheableQuery {
  string GetCacheKey();
  TimeSpan GetCacheDuration();
}
```

### 5. Performance Timing Behavior

```csharp
using System.Diagnostics;
using Whizbang.Core.Pipeline;

public class PerformanceBehavior<TRequest, TResponse>
  : IPipelineBehavior<TRequest, TResponse> {

  private readonly ILogger<PerformanceBehavior<TRequest, TResponse>> _logger;

  public PerformanceBehavior(ILogger<PerformanceBehavior<TRequest, TResponse>> logger) {
    _logger = logger;
  }

  public async Task<TResponse> Handle(
    TRequest request,
    Func<Task<TResponse>> next,
    CancellationToken cancellationToken
  ) {
    var stopwatch = Stopwatch.StartNew();

    try {
      var response = await next();
      stopwatch.Stop();

      var elapsedMs = stopwatch.ElapsedMilliseconds;
      var requestName = typeof(TRequest).Name;

      if (elapsedMs > 500) {
        // Slow request warning
        _logger.LogWarning(
          "Slow request: {RequestName} took {ElapsedMs}ms",
          requestName,
          elapsedMs
        );
      } else {
        _logger.LogInformation(
          "{RequestName} completed in {ElapsedMs}ms",
          requestName,
          elapsedMs
        );
      }

      return response;
    } catch {
      stopwatch.Stop();
      throw;
    }
  }
}
```

---

## Registration and Ordering

### Registration

```csharp
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

// Behaviors execute in registration order
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(LoggingBehavior<,>));       // 1st
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));   // 2nd
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(RetryBehavior<,>));        // 3rd
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(PerformanceBehavior<,>));  // 4th

var app = builder.Build();
```

**Execution Order**:
1. **LoggingBehavior** - Logs request
2. **ValidationBehavior** - Validates request
3. **RetryBehavior** - Wraps execution with retry
4. **PerformanceBehavior** - Measures timing
5. **Receptor** - Business logic

### Conditional Registration

```csharp
// Only register in development
if (builder.Environment.IsDevelopment()) {
  builder.Services.AddTransient(
    typeof(IPipelineBehavior<,>),
    typeof(DebugBehavior<,>)
  );
}

// Only register for specific message types
builder.Services.AddTransient<IPipelineBehavior<CreateOrder, OrderCreated>,
  OrderValidationBehavior>();
```

---

## Advanced Patterns

### Short-Circuiting

```csharp
public class AuthorizationBehavior<TRequest, TResponse>
  : IPipelineBehavior<TRequest, TResponse>
  where TRequest : IAuthorizedRequest {

  private readonly IAuthorizationService _authService;

  public async Task<TResponse> Handle(
    TRequest request,
    Func<Task<TResponse>> next,
    CancellationToken cancellationToken
  ) {
    // Check authorization
    var isAuthorized = await _authService.IsAuthorizedAsync(
      request.UserId,
      request.RequiredPermission
    );

    if (!isAuthorized) {
      // Short-circuit - do NOT call next()
      throw new UnauthorizedAccessException(
        $"User {request.UserId} lacks permission {request.RequiredPermission}"
      );
    }

    // Authorized - continue
    return await next();
  }
}
```

### Response Modification

```csharp
public class EnrichmentBehavior<TRequest, TResponse>
  : IPipelineBehavior<TRequest, TResponse>
  where TResponse : IEnrichableResponse {

  private readonly IUserContextService _userContext;

  public async Task<TResponse> Handle(
    TRequest request,
    Func<Task<TResponse>> next,
    CancellationToken cancellationToken
  ) {
    // Execute handler
    var response = await next();

    // Modify response
    response.UserId = _userContext.GetCurrentUserId();
    response.Timestamp = DateTimeOffset.UtcNow;

    return response;
  }
}
```

### Transaction Management

```csharp
public class TransactionBehavior<TRequest, TResponse>
  : IPipelineBehavior<TRequest, TResponse>
  where TRequest : ITransactionalCommand {

  private readonly IDbConnectionFactory _connectionFactory;

  public async Task<TResponse> Handle(
    TRequest request,
    Func<Task<TResponse>> next,
    CancellationToken cancellationToken
  ) {
    using var connection = await _connectionFactory.CreateConnectionAsync(cancellationToken);
    using var transaction = await connection.BeginTransactionAsync(cancellationToken);

    try {
      // Execute within transaction
      var response = await next();

      // Commit on success
      await transaction.CommitAsync(cancellationToken);
      return response;
    } catch {
      // Rollback on failure
      await transaction.RollbackAsync(cancellationToken);
      throw;
    }
  }
}
```

---

## Best Practices

### DO ✅

- ✅ **Keep behaviors small and focused** - Single responsibility
- ✅ **Register in logical order** (logging → validation → retry → handler)
- ✅ **Use marker interfaces** for conditional behaviors (ICacheableQuery)
- ✅ **Always call next()** unless intentionally short-circuiting
- ✅ **Handle exceptions appropriately** (log, wrap, or propagate)
- ✅ **Use async/await consistently** - Don't block
- ✅ **Make behaviors reusable** - Generic across message types

### DON'T ❌

- ❌ Put business logic in behaviors (keep in receptors)
- ❌ Mutate request in behaviors (immutable messages)
- ❌ Forget to call next() (pipeline will hang)
- ❌ Swallow exceptions silently (breaks error handling)
- ❌ Register too many behaviors (keep pipeline lean)
- ❌ Use behaviors for message routing (use policies instead)

---

## Troubleshooting

### Problem: Behavior Not Executing

**Symptoms**: Behavior code never runs.

**Causes**:
1. Not registered in DI
2. Wrong generic type registration

**Solution**:
```csharp
// ❌ WRONG: Concrete type registration
builder.Services.AddTransient<LoggingBehavior<CreateOrder, OrderCreated>>();

// ✅ CORRECT: Open generic registration
builder.Services.AddTransient(
  typeof(IPipelineBehavior<,>),
  typeof(LoggingBehavior<,>)
);
```

### Problem: Pipeline Hangs

**Symptoms**: Request never completes.

**Cause**: Behavior doesn't call `next()`.

**Solution**:
```csharp
// ❌ WRONG: Forgot to call next()
public async Task<TResponse> Handle(TRequest request, Func<Task<TResponse>> next, ...) {
  _logger.LogInformation("Processing...");
  // Missing: await next()
  return default!;  // Never executes handler!
}

// ✅ CORRECT: Always call next()
public async Task<TResponse> Handle(TRequest request, Func<Task<TResponse>> next, ...) {
  _logger.LogInformation("Processing...");
  return await next();  // ⭐ Essential
}
```

### Problem: Wrong Execution Order

**Symptoms**: Behaviors run in unexpected order.

**Cause**: Registration order determines execution order.

**Solution**:
```csharp
// Execution order = registration order
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(FirstBehavior<,>));   // Runs 1st
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(SecondBehavior<,>));  // Runs 2nd
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ThirdBehavior<,>));   // Runs 3rd
```

---

## Further Reading

**Extensibility**:
- [Custom Receptors](custom-receptors.md) - Advanced receptor patterns
- [Custom Policies](custom-policies.md) - Dynamic routing logic

**Core Concepts**:
- [Receptors](../core-concepts/receptors.md) - Message handlers
- [Dispatcher](../core-concepts/dispatcher.md) - Message routing

**Infrastructure**:
- [Policies](../infrastructure/policies.md) - Policy-based routing

**External Resources**:
- [MediatR Pipeline Behaviors](https://github.com/jbogard/MediatR/wiki/Behaviors)
- [ASP.NET Core Middleware](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/)

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
