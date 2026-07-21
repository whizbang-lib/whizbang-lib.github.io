---
title: REST Mutations
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: REST
order: 3
description: >-
  Command endpoints for REST APIs - generated FastEndpoints with customizable
  hooks for validation, logging, and error handling
tags: 'rest, mutations, commands, fastendpoints, validation, hooks'
codeReferences:
  - src/Whizbang.Transports.FastEndpoints/Endpoints/RestMutationEndpointBase.cs
  - src/Whizbang.Transports.Mutations/Base/MutationEndpointBase.cs
  - src/Whizbang.Transports.Mutations/Base/IMutationContext.cs
  - src/Whizbang.Transports.Mutations/Attributes/CommandEndpointAttribute.cs
  - src/Whizbang.Transports.FastEndpoints.Generators/RestMutationEndpointGenerator.cs
testReferences:
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/RestMutationEndpointBaseTests.cs
  - tests/Whizbang.Transports.Mutations.Tests/Unit/MutationEndpointBaseTests.cs
  - tests/Whizbang.Transports.Mutations.Tests/Unit/MutationContextTests.cs
  - tests/Whizbang.Transports.Mutations.Tests/Unit/CommandEndpointAttributeTests.cs
lastMaintainedCommit: '01f07906'
---

# REST Mutations

Whizbang generates REST mutation endpoints for commands using FastEndpoints, providing a consistent hook architecture for validation, logging, and error handling.

## Overview

REST mutations provide:

- **Generated Endpoints** - Source generators create endpoint classes from `[CommandEndpoint]` attributes on command classes
- **Hook Architecture** - `OnBefore`, `OnAfter`, `OnError` hooks for customization
- **Partial Classes** - Extend generated endpoints with custom logic
- **Consistent Patterns** - Same hooks across REST (FastEndpoints) and GraphQL (HotChocolate) transports

## Defining Mutation Endpoints

The `[CommandEndpoint<TCommand, TResult>]` attribute is placed on the **command class** itself. The source generator discovers it and emits a `<CommandName>Endpoint` class in a `.Generated` sub-namespace.

### Basic Command Endpoint

```csharp{title="Basic Command Endpoint" description="Basic Command Endpoint" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Basic", "Command"] tests=["CommandEndpointAttributeTests.Attribute_WithOnlyRestRoute_ShouldWorkAsync", "CommandEndpointAttributeTests.RestRoute_ShouldBeSettableAsync", "CommandEndpointAttributeTests.Attribute_ShouldBeApplicableToClassesOnlyAsync", "CommandEndpointAttributeTests.TCommand_ShouldBeConstrainedToICommandAsync"]}
[CommandEndpoint<CreateOrderCommand, OrderResult>(RestRoute = "/api/orders")]
public class CreateOrderCommand : ICommand {
    public required Guid CustomerId { get; init; }
}
// Generates: CreateOrderCommandEndpoint (POST /api/orders)
```

### With Custom Request DTO

```csharp{title="With Custom Request DTO" description="With Custom Request DTO" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Custom", "Request"] tests=["CommandEndpointAttributeTests.RequestType_ShouldBeSettableAsync", "CommandEndpointAttributeTests.RestRoute_ShouldBeSettableAsync", "MutationEndpointBaseTests.MapRequestToCommandAsync_Default_ShouldThrowNotImplementedAsync"]}
[CommandEndpoint<CreateOrderCommand, OrderResult>(
    RestRoute = "/api/orders",
    RequestType = typeof(CreateOrderRequest))]
public class CreateOrderCommand : ICommand { }
// You must override MapRequestToCommandAsync in your partial class
```

### CommandEndpointAttribute Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `RestRoute` | `string?` | `null` | REST route; if null, no REST endpoint is generated |
| `GraphQLMutation` | `string?` | `null` | GraphQL mutation field name; if null, no GraphQL mutation is generated |
| `RequestType` | `Type?` | `null` | Optional custom request DTO type |

:::updated
There is no `HttpMethod` property on `[CommandEndpoint]`. All generated REST mutation endpoints are registered as **POST** routes (`MapPost`) at this commit.
:::

## RestMutationEndpointBase

Generated endpoints inherit from `RestMutationEndpointBase<TCommand, TResult>`, which provides the hook architecture:

```csharp{title="RestMutationEndpointBase" description="Generated endpoints inherit from RestMutationEndpointBase<TCommand, TResult>, which provides the hook architecture:" category="API" difficulty="ADVANCED" tags=["Apis", "Rest", "RestMutationEndpointBase"] tests=["RestMutationEndpointBaseTests.Endpoint_ShouldBeAbstractAsync", "RestMutationEndpointBaseTests.Endpoint_ShouldInheritFromMutationEndpointBaseAsync"]}
public abstract class RestMutationEndpointBase<TCommand, TResult>
    : MutationEndpointBase<TCommand, TResult>
    where TCommand : ICommand {
}
```

## Hook Architecture

The hook lifecycle in `ExecuteAsync` is:

1. Check cancellation
2. `OnBeforeExecuteAsync`
3. `DispatchCommandAsync`
4. `OnAfterExecuteAsync` (on success) or `OnErrorAsync` (on failure)

An `IMutationContext` is passed to every hook. It exposes the request `CancellationToken` and an `Items` dictionary (`IDictionary<string, object?>`) for sharing state between hooks.

### OnBeforeExecuteAsync

Called before command dispatch. Use for validation, authorization, or logging.

```csharp{title="OnBeforeExecuteAsync" description="Called before command execution." category="API" difficulty="ADVANCED" tags=["Apis", "Rest", "OnBeforeExecuteAsync"] tests=["MutationEndpointBaseTests.ExecuteAsync_ShouldCallOnBeforeExecuteAsync", "RestMutationEndpointBaseTests.Execute_ShouldCallOnBeforeExecuteAsync", "RestMutationEndpointBaseTests.OnBeforeExecute_ShouldReceiveCommandAsync"]}
public partial class CreateOrderCommandEndpoint {
    protected override async ValueTask OnBeforeExecuteAsync(
        CreateOrderCommand command,
        IMutationContext context,
        CancellationToken ct) {
        // Validate the command
        await _validator.ValidateAndThrowAsync(command, ct);

        // Log the operation
        _logger.LogInformation("Creating order for customer {CustomerId}", command.CustomerId);
    }
}
```

### OnAfterExecuteAsync

Called after successful command dispatch. Not called if dispatch throws. Use for post-processing or notifications.

```csharp{title="OnAfterExecuteAsync" description="Called after successful command execution." category="API" difficulty="ADVANCED" tags=["Apis", "Rest", "OnAfterExecuteAsync"] tests=["MutationEndpointBaseTests.ExecuteAsync_ShouldCallOnAfterExecuteAsync", "RestMutationEndpointBaseTests.Execute_ShouldCallOnAfterExecuteAsync", "RestMutationEndpointBaseTests.OnAfterExecute_ShouldReceiveResultAsync"]}
public partial class CreateOrderCommandEndpoint {
    protected override async ValueTask OnAfterExecuteAsync(
        CreateOrderCommand command,
        OrderResult result,
        IMutationContext context,
        CancellationToken ct) {
        // Send confirmation email
        await _emailService.SendOrderConfirmationAsync(result.OrderId, ct);

        // Log success
        _logger.LogInformation("Order {OrderId} created successfully", result.OrderId);
    }
}
```

### OnErrorAsync

Called when command dispatch throws. Return a result to **suppress** the exception, or return `null` (the default) to **rethrow** it.

```csharp{title="OnErrorAsync" description="Called when command execution fails." category="API" difficulty="ADVANCED" tags=["Apis", "Rest", "OnErrorAsync"] tests=["RestMutationEndpointBaseTests.Execute_WhenDispatchThrows_ShouldCallOnErrorAsync", "RestMutationEndpointBaseTests.Execute_WhenOnErrorReturnsResult_ShouldReturnThatResultAsync", "RestMutationEndpointBaseTests.Execute_WhenOnErrorReturnsNull_ShouldRethrowAsync", "RestMutationEndpointBaseTests.OnError_ShouldReceiveExceptionAsync"]}
public partial class CreateOrderCommandEndpoint {
    protected override ValueTask<OrderResult?> OnErrorAsync(
        CreateOrderCommand command,
        Exception ex,
        IMutationContext context,
        CancellationToken ct) {
        _logger.LogError(ex, "Failed to create order for customer {CustomerId}", command.CustomerId);

        // Return a fallback result to suppress known errors
        if (ex is ValidationException) {
            return ValueTask.FromResult<OrderResult?>(
                new OrderResult(Guid.Empty, "ValidationFailed", 0m));
        }

        // Return null to rethrow unexpected exceptions
        return ValueTask.FromResult<OrderResult?>(null);
    }
}
```

## Complete Example

### Command Definition

```csharp{title="Command Definition" description="Command Definition" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Command", "Definition"] unverified="user-domain command/result records for the complete example — the [CommandEndpoint] RestRoute config it carries is verified on the Basic Command Endpoint block (CommandEndpointAttributeTests)"}
[CommandEndpoint<CreateOrderCommand, OrderResult>(RestRoute = "/api/orders")]
public record CreateOrderCommand(
    Guid CustomerId,
    List<OrderLineItem> Items,
    ShippingAddress ShippingAddress) : ICommand;

public record OrderResult(
    Guid OrderId,
    string Status,
    decimal TotalAmount);
```

### Generated Endpoint (Simplified)

```csharp{title="Generated Endpoint (Simplified)" description="Generated Endpoint (Simplified)" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Rest", "Generated", "Endpoint"] unverified="illustrative simplified generator output — MapPost minimal-API route wiring plus generated endpoint shape; the RestMutationEndpointBase dispatch/execute lifecycle it builds on is verified by RestMutationEndpointBaseTests, but the generator emission is not covered by this page's tests"}
// Generated by RestMutationEndpointGenerator in the <CommandNamespace>.Generated namespace
public partial class CreateOrderCommandEndpoint
    : RestMutationEndpointBase<CreateOrderCommand, OrderResult>,
      IEndpoint {
    private readonly IDispatcher _dispatcher;

    public CreateOrderCommandEndpoint(IDispatcher dispatcher) {
        _dispatcher = dispatcher;
    }

    public void Configure(IEndpointRouteBuilder routeBuilder) {
        routeBuilder.MapPost("/api/orders", HandleAsync);
    }

    protected override async ValueTask<OrderResult> DispatchCommandAsync(
        CreateOrderCommand command,
        CancellationToken ct) {
        return await _dispatcher.LocalInvokeAsync<CreateOrderCommand, OrderResult>(command, ct);
    }

    public async Task<OrderResult> HandleAsync(CreateOrderCommand command, CancellationToken ct) {
        return await ExecuteAsync(command, ct);
    }
}
```

### Custom Extension

```csharp{title="Custom Extension" description="Custom Extension" category="API" difficulty="ADVANCED" tags=["Apis", "Rest", "Custom", "Extension"] unverified="illustrative custom partial-class extension — constructor chaining to the generated ctor plus validator/logger DI wiring; the OnBefore/OnAfter hook overrides it shows are verified on their own blocks (MutationEndpointBaseTests / RestMutationEndpointBaseTests)"}
// Your partial class for customization
// Must be declared in the same <CommandNamespace>.Generated namespace as the generated class
public partial class CreateOrderCommandEndpoint {
    private readonly IValidator<CreateOrderCommand> _validator;
    private readonly ILogger<CreateOrderCommandEndpoint> _logger;

    // Chain to the generated constructor for additional dependencies
    public CreateOrderCommandEndpoint(
        IDispatcher dispatcher,
        IValidator<CreateOrderCommand> validator,
        ILogger<CreateOrderCommandEndpoint> logger) : this(dispatcher) {
        _validator = validator;
        _logger = logger;
    }

    protected override async ValueTask OnBeforeExecuteAsync(
        CreateOrderCommand command,
        IMutationContext context,
        CancellationToken ct) {
        await _validator.ValidateAndThrowAsync(command, ct);
    }

    protected override async ValueTask OnAfterExecuteAsync(
        CreateOrderCommand command,
        OrderResult result,
        IMutationContext context,
        CancellationToken ct) {
        _logger.LogInformation("Order {OrderId} created with total {Total}",
            result.OrderId, result.TotalAmount);
    }
}
```

## Request/Response Examples

### Create Order

**Request:**
```http
POST /api/orders
Content-Type: application/json

{
  "customerId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "items": [
    { "productId": "abc123", "quantity": 2, "unitPrice": 29.99 }
  ],
  "shippingAddress": {
    "street": "123 Main St",
    "city": "Springfield",
    "state": "IL",
    "zipCode": "62701"
  }
}
```

**Response:**
```json{title="Create Order" description="Create Order" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Create", "Order"]}
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "Pending",
  "totalAmount": 59.98
}
```

### Update Order

Updates are modeled as separate commands with their own routes. All generated mutation endpoints use POST.

**Request:**
```http
POST /api/orders/update
Content-Type: application/json

{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "Shipped",
  "trackingNumber": "1Z999AA10123456784"
}
```

## Validation Integration

### FluentValidation

```csharp{title="FluentValidation" description="FluentValidation" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "FluentValidation"] unverified="third-party FluentValidation AbstractValidator usage — not a Whizbang API or behavior"}
public class CreateOrderCommandValidator : AbstractValidator<CreateOrderCommand> {
    public CreateOrderCommandValidator() {
        RuleFor(x => x.CustomerId).NotEmpty();
        RuleFor(x => x.Items).NotEmpty().WithMessage("Order must contain at least one item");
        RuleFor(x => x.ShippingAddress).NotNull();
    }
}
```

### In Hook

```csharp{title="In Hook" description="In Hook" category="API" difficulty="ADVANCED" tags=["Apis", "Rest", "Hook"] unverified="counter to implementation — ExecuteAsync invokes OnBeforeExecuteAsync outside its try/catch, so a throw here does NOT propagate to OnErrorAsync (only dispatch-time throws do); the stated propagation is not backed by the mutation-endpoint tests"}
protected override async ValueTask OnBeforeExecuteAsync(
    CreateOrderCommand command,
    IMutationContext context,
    CancellationToken ct) {
    var result = await _validator.ValidateAsync(command, ct);
    if (!result.IsValid) {
        // Throwing propagates to OnErrorAsync, which can suppress or rethrow
        throw new ValidationException(result.Errors);
    }
}
```

## Related Documentation

- [REST Setup](setup.md) - Installation and configuration
- [REST Filtering](filtering.md) - Query endpoints
- [Dispatcher](../../fundamentals/dispatcher/dispatcher.md) - Command execution
- [FastEndpoints Documentation](https://fast-endpoints.com/)
