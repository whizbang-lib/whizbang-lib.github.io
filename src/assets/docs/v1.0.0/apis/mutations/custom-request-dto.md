---
title: Custom Request DTOs
version: 1.0.0
category: Mutations
order: 2
description: >-
  Map custom request DTOs to commands for transport-specific input handling
tags: 'mutations, dto, mapping, requests, commands'
codeReferences:
  - src/Whizbang.Transports.Mutations/Base/MutationEndpointBase.cs
---

# Custom Request DTOs

By default, mutation endpoints use your command type directly as the request input. However, you can specify a custom request DTO type using the `RequestType` property on `CommandEndpointAttribute`. This enables scenarios where the API contract differs from your domain commands.

## When to Use Custom Request DTOs

Use custom request DTOs when:

- **API versioning**: Different API versions need different input shapes
- **Transport-specific formats**: REST needs flat objects, GraphQL needs nested inputs
- **Validation concerns**: Request DTOs have different validation than commands
- **Privacy**: Request DTOs exclude internal command fields
- **Conversion**: Input needs transformation (e.g., string to Guid)

## Basic Usage

### Step 1: Define the Request DTO

```csharp
// Request DTO - what the API receives
public record CreateOrderRequest(
    string CustomerEmail,           // User provides email, not ID
    List<OrderItemInput> Items
);

public record OrderItemInput(
    string ProductSku,              // User provides SKU, not ID
    int Quantity
);
```

### Step 2: Define the Command

```csharp
// Command - what the domain processes
public record CreateOrderCommand(
    Guid CustomerId,                // Domain uses ID
    List<OrderItem> Items
) : ICommand;

public record OrderItem(
    Guid ProductId,                 // Domain uses ID
    int Quantity,
    decimal UnitPrice
);
```

### Step 3: Configure the Endpoint

```csharp
[CommandEndpoint<CreateOrderCommand, OrderResult>(
    RestRoute = "/api/orders",
    GraphQLMutation = "createOrder",
    RequestType = typeof(CreateOrderRequest))]    // Specify custom request type
public partial class CreateOrderEndpoint {
    // ... implementation
}
```

### Step 4: Override MapRequestToCommandAsync {#mapping}

You **must** override `MapRequestToCommandAsync` when using `RequestType`. The default implementation throws `NotImplementedException`:

```csharp
public partial class CreateOrderEndpoint {
    private readonly ICustomerLookup _customers;
    private readonly IProductLookup _products;

    protected override async ValueTask<CreateOrderCommand> MapRequestToCommandAsync<TRequest>(
        TRequest request,
        CancellationToken ct) where TRequest : notnull {

        // Cast to your specific request type
        var orderRequest = (CreateOrderRequest)(object)request;

        // Look up customer by email
        var customerId = await _customers.GetIdByEmailAsync(
            orderRequest.CustomerEmail,
            ct);

        if (customerId is null) {
            throw new ValidationException("Customer not found");
        }

        // Map items with product lookup
        var items = new List<OrderItem>();
        foreach (var input in orderRequest.Items) {
            var product = await _products.GetBySkuAsync(input.ProductSku, ct);

            if (product is null) {
                throw new ValidationException($"Product {input.ProductSku} not found");
            }

            items.Add(new OrderItem(
                ProductId: product.Id,
                Quantity: input.Quantity,
                UnitPrice: product.Price
            ));
        }

        return new CreateOrderCommand(
            CustomerId: customerId.Value,
            Items: items
        );
    }
}
```

## The MapRequestToCommandAsync Method {#execution}

**Signature**:
```csharp
protected virtual ValueTask<TCommand> MapRequestToCommandAsync<TRequest>(
    TRequest request,
    CancellationToken ct) where TRequest : notnull
```

**Parameters**:
- `request` - The incoming request DTO
- `ct` - The cancellation token

**Returns**: The command to be dispatched

**Default Behavior**: Throws `NotImplementedException` with a helpful message:
```
When using a custom RequestType, you must override MapRequestToCommandAsync
in your partial class to map CreateOrderRequest to CreateOrderCommand.
```

### Execution Flow

When you specify `RequestType`, the generated endpoint calls `ExecuteWithRequestAsync` instead of `ExecuteAsync`:

```
Request arrives (CreateOrderRequest)
  |
  +-> ExecuteWithRequestAsync(request, ct)
        |
        +-> MapRequestToCommandAsync(request, ct)  <-- Your override
        |       |
        |       +-> Returns CreateOrderCommand
        |
        +-> ExecuteAsync(command, ct)
              |
              +-> OnBeforeExecuteAsync(...)
              +-> DispatchCommandAsync(...)
              +-> OnAfterExecuteAsync(...) / OnErrorAsync(...)
```

## Patterns

### Pattern 1: Simple Field Mapping

When fields just need renaming or type conversion:

```csharp
// Request
public record UpdateProductRequest(
    string Id,              // String in API
    string Name,
    string PriceString      // String for decimal
);

// Command
public record UpdateProductCommand(
    Guid Id,                // Guid in domain
    string Name,
    decimal Price
) : ICommand;

// Mapping
protected override ValueTask<UpdateProductCommand> MapRequestToCommandAsync<TRequest>(
    TRequest request,
    CancellationToken ct) where TRequest : notnull {

    var req = (UpdateProductRequest)(object)request;

    return ValueTask.FromResult(new UpdateProductCommand(
        Id: Guid.Parse(req.Id),
        Name: req.Name,
        Price: decimal.Parse(req.PriceString)
    ));
}
```

### Pattern 2: Enrichment from Services

When the command needs data from services:

```csharp
public partial class CreateOrderEndpoint {
    private readonly ICurrentUser _user;
    private readonly IClock _clock;

    protected override ValueTask<CreateOrderCommand> MapRequestToCommandAsync<TRequest>(
        TRequest request,
        CancellationToken ct) where TRequest : notnull {

        var req = (CreateOrderRequest)(object)request;

        return ValueTask.FromResult(new CreateOrderCommand(
            OrderId: Guid.CreateVersion7(),
            CustomerId: _user.Id,           // From current user context
            Items: req.Items,
            CreatedAt: _clock.UtcNow        // From clock service
        ));
    }
}
```

### Pattern 3: Async Lookups

When mapping requires database queries:

```csharp
public partial class AssignTaskEndpoint {
    private readonly IUserLookup _users;
    private readonly IProjectLookup _projects;

    protected override async ValueTask<AssignTaskCommand> MapRequestToCommandAsync<TRequest>(
        TRequest request,
        CancellationToken ct) where TRequest : notnull {

        var req = (AssignTaskRequest)(object)request;

        // Parallel lookups for efficiency
        var userTask = _users.GetByEmailAsync(req.AssigneeEmail, ct);
        var projectTask = _projects.GetByCodeAsync(req.ProjectCode, ct);

        await Task.WhenAll(userTask, projectTask);

        var user = await userTask
            ?? throw new ValidationException($"User {req.AssigneeEmail} not found");
        var project = await projectTask
            ?? throw new ValidationException($"Project {req.ProjectCode} not found");

        return new AssignTaskCommand(
            TaskId: Guid.CreateVersion7(),
            ProjectId: project.Id,
            AssigneeId: user.Id,
            Title: req.Title,
            Description: req.Description
        );
    }
}
```

### Pattern 4: Conditional Mapping

When mapping logic varies based on request content:

```csharp
public partial class ProcessPaymentEndpoint {
    private readonly IPaymentGatewayResolver _gateways;

    protected override async ValueTask<ProcessPaymentCommand> MapRequestToCommandAsync<TRequest>(
        TRequest request,
        CancellationToken ct) where TRequest : notnull {

        var req = (PaymentRequest)(object)request;

        // Select gateway based on payment method
        var gateway = req.PaymentMethod switch {
            "credit_card" => await _gateways.GetStripeGatewayAsync(ct),
            "bank_transfer" => await _gateways.GetPlaidGatewayAsync(ct),
            "crypto" => await _gateways.GetCoinbaseGatewayAsync(ct),
            _ => throw new ValidationException($"Unknown payment method: {req.PaymentMethod}")
        };

        return new ProcessPaymentCommand(
            PaymentId: Guid.CreateVersion7(),
            Amount: req.Amount,
            Currency: req.Currency,
            GatewayId: gateway.Id,
            GatewayConfig: gateway.Config
        );
    }
}
```

## Validation in Mapping

You can perform validation during mapping:

```csharp
protected override async ValueTask<CreateOrderCommand> MapRequestToCommandAsync<TRequest>(
    TRequest request,
    CancellationToken ct) where TRequest : notnull {

    var req = (CreateOrderRequest)(object)request;

    // Validate request
    if (string.IsNullOrWhiteSpace(req.CustomerEmail)) {
        throw new ValidationException("Customer email is required");
    }

    if (!req.Items.Any()) {
        throw new ValidationException("At least one item is required");
    }

    // Validate each item
    foreach (var item in req.Items) {
        if (item.Quantity <= 0) {
            throw new ValidationException($"Invalid quantity for {item.ProductSku}");
        }
    }

    // Continue with mapping...
    return new CreateOrderCommand(/* ... */);
}
```

**Note**: For complex validation, consider using FluentValidation in `OnBeforeExecuteAsync` instead. The mapping method is best for transformation logic.

## Error Handling

Exceptions thrown from `MapRequestToCommandAsync` are **not** caught by `OnErrorAsync`. They propagate directly to the transport layer. This is intentional:

- Mapping errors are typically validation errors (4xx)
- Command execution errors are typically business errors (handled by `OnErrorAsync`)

```csharp
// Mapping errors - return 400 Bad Request
protected override ValueTask<TCommand> MapRequestToCommandAsync<TRequest>(...) {
    // This exception becomes HTTP 400
    throw new ValidationException("Invalid input");
}

// Execution errors - handled by OnErrorAsync
protected override async ValueTask OnErrorAsync(...) {
    // Business logic errors handled here
}
```

## Complete Example

```csharp
// Request DTO
public record TransferFundsRequest(
    string FromAccountNumber,
    string ToAccountNumber,
    decimal Amount,
    string Currency,
    string? Reference
);

// Command
public record TransferFundsCommand(
    Guid TransferId,
    Guid FromAccountId,
    Guid ToAccountId,
    Money Amount,
    string? Reference,
    Guid InitiatedBy
) : ICommand;

// Endpoint
[CommandEndpoint<TransferFundsCommand, TransferResult>(
    RestRoute = "/api/transfers",
    GraphQLMutation = "transferFunds",
    RequestType = typeof(TransferFundsRequest))]
public partial class TransferFundsEndpoint {
    private readonly IAccountLookup _accounts;
    private readonly ICurrentUser _user;
    private readonly ICurrencyService _currencies;

    protected override async ValueTask<TransferFundsCommand> MapRequestToCommandAsync<TRequest>(
        TRequest request,
        CancellationToken ct) where TRequest : notnull {

        var req = (TransferFundsRequest)(object)request;

        // Validate currency
        if (!_currencies.IsSupported(req.Currency)) {
            throw new ValidationException($"Currency {req.Currency} is not supported");
        }

        // Look up accounts
        var fromAccount = await _accounts.GetByNumberAsync(req.FromAccountNumber, ct)
            ?? throw new ValidationException($"Account {req.FromAccountNumber} not found");

        var toAccount = await _accounts.GetByNumberAsync(req.ToAccountNumber, ct)
            ?? throw new ValidationException($"Account {req.ToAccountNumber} not found");

        // Verify user has access to source account
        if (fromAccount.OwnerId != _user.Id) {
            throw new UnauthorizedAccessException("You don't have access to this account");
        }

        return new TransferFundsCommand(
            TransferId: Guid.CreateVersion7(),
            FromAccountId: fromAccount.Id,
            ToAccountId: toAccount.Id,
            Amount: new Money(req.Amount, req.Currency),
            Reference: req.Reference,
            InitiatedBy: _user.Id
        );
    }
}
```

## See Also

- [Mutation Hooks](hooks.md) - Pre/post execution hooks
- [Dispatcher](../core-concepts/dispatcher.md) - Command dispatch patterns
- [Receptors](../core-concepts/receptors.md) - Command handlers

---

*Version 1.0.0 - Foundation Release*
