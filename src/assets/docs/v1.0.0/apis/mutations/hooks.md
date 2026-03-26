---
title: Mutation Hooks
version: 1.0.0
category: Mutations
order: 1
description: >-
  Pre/post execution hooks for mutation endpoints - validation, logging,
  notifications, and error handling
tags: 'mutations, hooks, lifecycle, validation, error-handling'
codeReferences:
  - src/Whizbang.Transports.Mutations/Base/MutationEndpointBase.cs
  - src/Whizbang.Transports.Mutations/Base/IMutationContext.cs
---

# Mutation Hooks

Mutation hooks provide extension points for adding cross-cutting concerns to your command endpoints. The `MutationEndpointBase<TCommand, TResult>` class defines three virtual methods you can override to hook into the execution lifecycle.

## Quick Reference

| Hook | When Called | Common Uses |
|------|-------------|-------------|
| `OnBeforeExecuteAsync` | Before command dispatch | Validation, authorization, logging |
| `OnAfterExecuteAsync` | After successful dispatch | Notifications, audit logging |
| `OnErrorAsync` | When dispatch throws | Error handling, fallback results |

## The Execution Lifecycle {#lifecycle}

The `ExecuteAsync` method orchestrates the hook lifecycle:

```
ExecuteAsync(command, ct)
  |
  +-> Check cancellation (throws if cancelled)
  |
  +-> Create MutationContext
  |
  +-> OnBeforeExecuteAsync(command, context, ct)
  |
  +-> DispatchCommandAsync(command, ct)
  |       |
  |       +-> Success: OnAfterExecuteAsync(command, result, context, ct)
  |       |
  |       +-> Exception: OnErrorAsync(command, ex, context, ct)
  |                |
  |                +-> Returns result: Use that result
  |                |
  |                +-> Returns null: Rethrow exception
  |
  +-> Return result
```

## OnBeforeExecuteAsync {#before}

Called before command dispatch. Override to add validation, logging, authorization, or other pre-processing.

**Signature**:
```csharp{title="OnBeforeExecuteAsync" description="OnBeforeExecuteAsync" category="API" difficulty="BEGINNER" tags=["Apis", "Mutations", "OnBeforeExecuteAsync", "Before"]}
protected virtual ValueTask OnBeforeExecuteAsync(
    TCommand command,
    IMutationContext context,
    CancellationToken ct) => ValueTask.CompletedTask;
```

**Parameters**:
- `command` - The command to be executed
- `context` - The mutation context with cancellation token and shared items
- `ct` - The cancellation token

### Example: Validation

```csharp{title="Example: Validation" description="Example: Validation" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Example:", "Validation"]}
public partial class CreateOrderEndpoint {
    private readonly IValidator<CreateOrderCommand> _validator;

    protected override async ValueTask OnBeforeExecuteAsync(
        CreateOrderCommand command,
        IMutationContext context,
        CancellationToken ct) {

        // Validate command before dispatch
        await _validator.ValidateAndThrowAsync(command, ct);
    }
}
```

### Example: Authorization

```csharp{title="Example: Authorization" description="Example: Authorization" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Example:", "Authorization"]}
public partial class UpdateProductEndpoint {
    private readonly IAuthorizationService _authz;
    private readonly ICurrentUser _user;

    protected override async ValueTask OnBeforeExecuteAsync(
        UpdateProductCommand command,
        IMutationContext context,
        CancellationToken ct) {

        var result = await _authz.AuthorizeAsync(
            _user.Principal,
            command,
            "ProductUpdatePolicy");

        if (!result.Succeeded) {
            throw new UnauthorizedAccessException("Not authorized to update product");
        }
    }
}
```

### Example: Timing

```csharp{title="Example: Timing" description="Example: Timing" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Example:", "Timing"]}
public partial class ProcessPaymentEndpoint {
    protected override ValueTask OnBeforeExecuteAsync(
        ProcessPaymentCommand command,
        IMutationContext context,
        CancellationToken ct) {

        // Store start time in context for use in OnAfterExecuteAsync
        context.Items["StartTime"] = Stopwatch.GetTimestamp();

        return ValueTask.CompletedTask;
    }
}
```

## OnAfterExecuteAsync {#after}

Called after successful command dispatch. Override to add post-processing, notifications, or audit logging. **Not called if dispatch throws an exception.**

**Signature**:
```csharp{title="OnAfterExecuteAsync" description="OnAfterExecuteAsync" category="API" difficulty="BEGINNER" tags=["Apis", "Mutations", "OnAfterExecuteAsync", "After"]}
protected virtual ValueTask OnAfterExecuteAsync(
    TCommand command,
    TResult result,
    IMutationContext context,
    CancellationToken ct) => ValueTask.CompletedTask;
```

**Parameters**:
- `command` - The executed command
- `result` - The result from command execution
- `context` - The mutation context with cancellation token and shared items
- `ct` - The cancellation token

### Example: Notifications

```csharp{title="Example: Notifications" description="Example: Notifications" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Example:", "Notifications"]}
public partial class CreateOrderEndpoint {
    private readonly INotificationService _notifications;

    protected override async ValueTask OnAfterExecuteAsync(
        CreateOrderCommand command,
        OrderResult result,
        IMutationContext context,
        CancellationToken ct) {

        // Send notification after successful order creation
        await _notifications.NotifyAsync(
            $"Order {result.OrderId} created for customer {command.CustomerId}",
            ct);
    }
}
```

### Example: Audit Logging

```csharp{title="Example: Audit Logging" description="Example: Audit Logging" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Example:", "Audit"]}
public partial class DeleteUserEndpoint {
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _user;

    protected override async ValueTask OnAfterExecuteAsync(
        DeleteUserCommand command,
        DeleteResult result,
        IMutationContext context,
        CancellationToken ct) {

        await _audit.LogAsync(new AuditEntry {
            Action = "UserDeleted",
            PerformedBy = _user.Id,
            TargetId = command.UserId,
            Timestamp = DateTimeOffset.UtcNow
        }, ct);
    }
}
```

### Example: Performance Logging

```csharp{title="Example: Performance Logging" description="Example: Performance Logging" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Example:", "Performance"]}
public partial class ProcessPaymentEndpoint {
    private readonly ILogger<ProcessPaymentEndpoint> _logger;

    protected override ValueTask OnAfterExecuteAsync(
        ProcessPaymentCommand command,
        PaymentResult result,
        IMutationContext context,
        CancellationToken ct) {

        if (context.Items.TryGetValue("StartTime", out var startObj)
            && startObj is long startTime) {

            var elapsed = Stopwatch.GetElapsedTime(startTime);
            _logger.LogInformation(
                "Payment {PaymentId} processed in {ElapsedMs}ms",
                result.PaymentId,
                elapsed.TotalMilliseconds);
        }

        return ValueTask.CompletedTask;
    }
}
```

## OnErrorAsync

Called when command dispatch throws an exception. Override to provide custom error handling, logging, or fallback results.

**Signature**:
```csharp{title="OnErrorAsync" description="OnErrorAsync" category="API" difficulty="BEGINNER" tags=["Apis", "Mutations", "OnErrorAsync"]}
protected virtual ValueTask<TResult?> OnErrorAsync(
    TCommand command,
    Exception ex,
    IMutationContext context,
    CancellationToken ct) => ValueTask.FromResult<TResult?>(default);
```

**Parameters**:
- `command` - The command that caused the error
- `ex` - The exception that was thrown
- `context` - The mutation context with cancellation token and shared items
- `ct` - The cancellation token

**Returns**:
- A result to return instead of throwing, or `null` to rethrow the exception

### Example: Error Logging

```csharp{title="Example: Error Logging" description="Example: Error Logging" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Example:", "Error"]}
public partial class CreateOrderEndpoint {
    private readonly ILogger<CreateOrderEndpoint> _logger;

    protected override ValueTask<OrderResult?> OnErrorAsync(
        CreateOrderCommand command,
        Exception ex,
        IMutationContext context,
        CancellationToken ct) {

        _logger.LogError(ex,
            "Failed to create order for customer {CustomerId}",
            command.CustomerId);

        // Return null to rethrow the exception
        return ValueTask.FromResult<OrderResult?>(null);
    }
}
```

### Example: Fallback Result

```csharp{title="Example: Fallback Result" description="Example: Fallback Result" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Example:", "Fallback"]}
public partial class GetCachedDataEndpoint {
    private readonly ICache _cache;

    protected override async ValueTask<DataResult?> OnErrorAsync(
        GetDataCommand command,
        Exception ex,
        IMutationContext context,
        CancellationToken ct) {

        // Try to return cached data as fallback
        var cached = await _cache.GetAsync<DataResult>(command.Key, ct);

        if (cached is not null) {
            return cached with { FromCache = true };
        }

        // No cached data - rethrow original exception
        return null;
    }
}
```

### Example: Error Transformation

```csharp{title="Example: Error Transformation" description="Example: Error Transformation" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Example:", "Error"]}
public partial class ExternalApiEndpoint {
    protected override ValueTask<ApiResult?> OnErrorAsync(
        ApiCommand command,
        Exception ex,
        IMutationContext context,
        CancellationToken ct) {

        // Transform external API errors into domain errors
        if (ex is HttpRequestException httpEx) {
            return ValueTask.FromResult<ApiResult?>(new ApiResult {
                Success = false,
                ErrorCode = "EXTERNAL_API_ERROR",
                ErrorMessage = "External service unavailable"
            });
        }

        // Rethrow other exceptions
        return ValueTask.FromResult<ApiResult?>(null);
    }
}
```

## IMutationContext {#context}

The `IMutationContext` interface provides context information during mutation execution. It is passed to all hooks and enables sharing state between them.

**Interface**:
```csharp{title="IMutationContext" description="IMutationContext" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Mutations", "IMutationContext", "Context"]}
public interface IMutationContext {
    /// <summary>
    /// The cancellation token for the current request.
    /// </summary>
    CancellationToken CancellationToken { get; }

    /// <summary>
    /// A dictionary for passing custom data between hooks.
    /// Use this to share state between OnBeforeExecuteAsync and OnAfterExecuteAsync.
    /// </summary>
    IDictionary<string, object?> Items { get; }
}
```

### Using Items for State Sharing

The `Items` dictionary enables passing data between hooks:

```csharp{title="Using Items for State Sharing" description="The Items dictionary enables passing data between hooks:" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Using", "Items"]}
public partial class OrderEndpoint {
    protected override ValueTask OnBeforeExecuteAsync(
        CreateOrderCommand command,
        IMutationContext context,
        CancellationToken ct) {

        // Store data in context
        context.Items["RequestId"] = Guid.NewGuid();
        context.Items["StartTime"] = DateTimeOffset.UtcNow;

        return ValueTask.CompletedTask;
    }

    protected override ValueTask OnAfterExecuteAsync(
        CreateOrderCommand command,
        OrderResult result,
        IMutationContext context,
        CancellationToken ct) {

        // Retrieve data from context
        var requestId = (Guid)context.Items["RequestId"]!;
        var startTime = (DateTimeOffset)context.Items["StartTime"]!;
        var duration = DateTimeOffset.UtcNow - startTime;

        _logger.LogInformation(
            "Request {RequestId} completed in {Duration}ms",
            requestId,
            duration.TotalMilliseconds);

        return ValueTask.CompletedTask;
    }
}
```

### MutationContext Implementation

The default `MutationContext` class implements `IMutationContext`:

```csharp{title="MutationContext Implementation" description="The default MutationContext class implements IMutationContext:" category="API" difficulty="BEGINNER" tags=["Apis", "Mutations", "MutationContext", "Implementation"]}
public sealed class MutationContext : IMutationContext {
    public MutationContext(CancellationToken cancellationToken) {
        CancellationToken = cancellationToken;
    }

    public CancellationToken CancellationToken { get; }
    public IDictionary<string, object?> Items { get; } = new Dictionary<string, object?>();
}
```

## Complete Example

Here is a complete example showing all hooks working together:

```csharp{title="Complete Example" description="Here is a complete example showing all hooks working together:" category="API" difficulty="ADVANCED" tags=["Apis", "Mutations", "Complete", "Example"]}
[CommandEndpoint<CreateOrderCommand, OrderResult>(
    RestRoute = "/api/orders",
    GraphQLMutation = "createOrder")]
public partial class CreateOrderEndpoint {
    private readonly IValidator<CreateOrderCommand> _validator;
    private readonly INotificationService _notifications;
    private readonly ILogger<CreateOrderEndpoint> _logger;

    protected override async ValueTask OnBeforeExecuteAsync(
        CreateOrderCommand command,
        IMutationContext context,
        CancellationToken ct) {

        // Validation
        await _validator.ValidateAndThrowAsync(command, ct);

        // Store timing info
        context.Items["StartTime"] = Stopwatch.GetTimestamp();

        _logger.LogInformation(
            "Creating order for customer {CustomerId}",
            command.CustomerId);
    }

    protected override async ValueTask OnAfterExecuteAsync(
        CreateOrderCommand command,
        OrderResult result,
        IMutationContext context,
        CancellationToken ct) {

        // Calculate duration
        var startTime = (long)context.Items["StartTime"]!;
        var elapsed = Stopwatch.GetElapsedTime(startTime);

        _logger.LogInformation(
            "Order {OrderId} created in {ElapsedMs}ms",
            result.OrderId,
            elapsed.TotalMilliseconds);

        // Send notification
        await _notifications.NotifyAsync(
            $"Order {result.OrderId} confirmed",
            ct);
    }

    protected override ValueTask<OrderResult?> OnErrorAsync(
        CreateOrderCommand command,
        Exception ex,
        IMutationContext context,
        CancellationToken ct) {

        _logger.LogError(ex,
            "Failed to create order for customer {CustomerId}",
            command.CustomerId);

        // Rethrow the exception
        return ValueTask.FromResult<OrderResult?>(null);
    }
}
```

## Transport-Specific Behavior

The hooks defined in `MutationEndpointBase<TCommand, TResult>` are inherited by transport-specific base classes:

- **FastEndpoints**: `RestMutationEndpointBase<TCommand, TResult>`
- **HotChocolate**: `GraphQLMutationBase<TCommand, TResult>`

Both transports call the hooks in the same order, providing consistent behavior across REST and GraphQL endpoints.

## See Also

- [Custom Request DTOs](custom-request-dto.md) - Map custom DTOs to commands
- [Dispatcher](../../fundamentals/dispatcher/dispatcher.md) - Command dispatch patterns
- [Receptors](../../fundamentals/receptors/receptors.md) - Command handlers

---

*Version 1.0.0 - Foundation Release*
