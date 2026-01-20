---
title: "Receptors Guide"
version: 0.1.0
category: Core Concepts
order: 2
description: "Master Whizbang Receptors - stateless message handlers that encapsulate business logic, validation, and decision-making"
tags: receptors, message-handlers, business-logic, validation
codeReferences:
  - src/Whizbang.Core/IReceptor.cs
  - samples/ECommerce/ECommerce.OrderService.API/Receptors/CreateOrderReceptor.cs
  - samples/ECommerce/ECommerce.InventoryWorker/Receptors/ReserveInventoryReceptor.cs
---

# Receptors Guide

**Receptors** are stateless message handlers that encapsulate business logic and decision-making in Whizbang applications. They receive commands/queries and return events/responses.

## Core Concept

A Receptor is analogous to a biological receptor:
- **Receives signals** (messages/commands)
- **Makes decisions** (business logic)
- **Produces responses** (events/responses)
- **Stateless** (no internal state, everything via parameters)

## IReceptor Interface

```csharp
namespace Whizbang.Core;

public interface IReceptor<in TMessage, TResponse>
    where TMessage : notnull {

    ValueTask<TResponse> HandleAsync(
        TMessage message,
        CancellationToken cancellationToken = default
    );
}
```

**Type Parameters**:
- `TMessage`: The incoming message/command type
- `TResponse`: The response/event type

**Key Characteristics**:
- **Stateless**: No instance fields, all data via parameters
- **Single Responsibility**: One receptor per message type
- **Async**: Returns `ValueTask<T>` for optimal performance
- **Type Safe**: Compile-time enforcement of message → response mapping

---

## Basic Example

```csharp
using Whizbang.Core;

public record CreateOrder(
    Guid CustomerId,
    OrderLineItem[] Items
);

public record OrderCreated(
    Guid OrderId,
    Guid CustomerId,
    OrderLineItem[] Items,
    decimal Total,
    DateTimeOffset CreatedAt
);

public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly ILogger<CreateOrderReceptor> _logger;

    public CreateOrderReceptor(ILogger<CreateOrderReceptor> logger) {
        _logger = logger;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {

        // Validation
        if (message.Items.Length == 0) {
            throw new ValidationException("Order must contain at least one item");
        }

        // Business logic
        var orderId = Guid.CreateVersion7();
        var total = message.Items.Sum(i => i.Quantity * i.UnitPrice);

        _logger.LogInformation(
            "Creating order {OrderId} for customer {CustomerId} with {ItemCount} items, total {Total:C}",
            orderId, message.CustomerId, message.Items.Length, total
        );

        // Return event (fact of what happened)
        return new OrderCreated(
            OrderId: orderId,
            CustomerId: message.CustomerId,
            Items: message.Items,
            Total: total,
            CreatedAt: DateTimeOffset.UtcNow
        );
    }
}
```

---

## Receptor Patterns

### Pattern 1: Command → Event

**Use Case**: State-changing operations

```csharp
public class CancelOrderReceptor : IReceptor<CancelOrder, OrderCancelled> {
    private readonly IDbConnectionFactory _db;
    private readonly ILogger<CancelOrderReceptor> _logger;

    public CancelOrderReceptor(
        IDbConnectionFactory db,
        ILogger<CancelOrderReceptor> logger) {
        _db = db;
        _logger = logger;
    }

    public async ValueTask<OrderCancelled> HandleAsync(
        CancelOrder message,
        CancellationToken ct = default) {

        await using var conn = _db.CreateConnection();

        // Load current state
        var order = await conn.QuerySingleOrDefaultAsync<Order>(
            "SELECT * FROM orders WHERE order_id = @OrderId",
            new { message.OrderId },
            ct
        );

        // Validation
        if (order is null) {
            throw new NotFoundException($"Order {message.OrderId} not found");
        }

        if (order.Status == "Shipped") {
            throw new InvalidOperationException("Cannot cancel shipped order");
        }

        _logger.LogInformation(
            "Cancelling order {OrderId}, reason: {Reason}",
            message.OrderId, message.Reason
        );

        // Return event
        return new OrderCancelled(
            OrderId: message.OrderId,
            Reason: message.Reason,
            CancelledAt: DateTimeOffset.UtcNow
        );
    }
}
```

**Key Points**:
- Commands are **imperative** (CancelOrder - intent to change state)
- Events are **past tense** (OrderCancelled - fact of what happened)
- Validation before event creation
- Event contains all relevant data for downstream consumers

### Pattern 2: Query → Response

**Use Case**: Read operations

```csharp
public record GetOrderDetails(Guid OrderId);

public record OrderDetails(
    Guid OrderId,
    Guid CustomerId,
    OrderLineItem[] Items,
    decimal Total,
    string Status,
    DateTimeOffset CreatedAt
);

public class GetOrderDetailsReceptor : IReceptor<GetOrderDetails, OrderDetails> {
    private readonly IOrderLens _lens;

    public GetOrderDetailsReceptor(IOrderLens lens) {
        _lens = lens;
    }

    public async ValueTask<OrderDetails> HandleAsync(
        GetOrderDetails query,
        CancellationToken ct = default) {

        var order = await _lens.GetOrderAsync(query.OrderId, ct);

        if (order is null) {
            throw new NotFoundException($"Order {query.OrderId} not found");
        }

        return new OrderDetails(
            OrderId: order.OrderId,
            CustomerId: order.CustomerId,
            Items: order.Items,
            Total: order.Total,
            Status: order.Status,
            CreatedAt: order.CreatedAt
        );
    }
}
```

**Key Points**:
- Queries are **questions** (GetOrderDetails)
- Responses are **answers** (OrderDetails)
- Read from optimized read models (via Lenses)
- No side effects (pure read operation)

### Pattern 3: Validation-Heavy Receptor

**Use Case**: Complex business rules

```csharp
public class ProcessPaymentReceptor : IReceptor<ProcessPayment, PaymentResult> {
    private readonly IPaymentGateway _gateway;
    private readonly IDbConnectionFactory _db;
    private readonly ILogger<ProcessPaymentReceptor> _logger;

    public ProcessPaymentReceptor(
        IPaymentGateway gateway,
        IDbConnectionFactory db,
        ILogger<ProcessPaymentReceptor> logger) {
        _gateway = gateway;
        _db = db;
        _logger = logger;
    }

    public async ValueTask<PaymentResult> HandleAsync(
        ProcessPayment message,
        CancellationToken ct = default) {

        // Validation Step 1: Order exists and is valid
        await ValidateOrderAsync(message.OrderId, ct);

        // Validation Step 2: Payment amount matches order total
        await ValidateAmountAsync(message.OrderId, message.Amount, ct);

        // Validation Step 3: Payment method is valid
        ValidatePaymentMethod(message.PaymentMethod);

        // Business Logic: Process payment
        try {
            var transactionId = await _gateway.ChargeAsync(
                message.PaymentMethod,
                message.Amount,
                ct
            );

            _logger.LogInformation(
                "Payment processed for order {OrderId}, transaction {TransactionId}",
                message.OrderId, transactionId
            );

            return new PaymentResult(
                OrderId: message.OrderId,
                Amount: message.Amount,
                TransactionId: transactionId,
                IsSuccess: true,
                ErrorCode: null
            );

        } catch (PaymentDeclinedException ex) {
            _logger.LogWarning(
                ex,
                "Payment declined for order {OrderId}",
                message.OrderId
            );

            return new PaymentResult(
                OrderId: message.OrderId,
                Amount: message.Amount,
                TransactionId: null,
                IsSuccess: false,
                ErrorCode: ex.ErrorCode
            );
        }
    }

    private async Task ValidateOrderAsync(Guid orderId, CancellationToken ct) {
        await using var conn = _db.CreateConnection();
        var order = await conn.QuerySingleOrDefaultAsync<Order>(
            "SELECT * FROM orders WHERE order_id = @OrderId",
            new { OrderId = orderId },
            ct
        );

        if (order is null) {
            throw new NotFoundException($"Order {orderId} not found");
        }

        if (order.Status != "Created") {
            throw new InvalidOperationException(
                $"Order {orderId} is not in valid state for payment (status: {order.Status})"
            );
        }
    }

    private async Task ValidateAmountAsync(
        Guid orderId,
        decimal amount,
        CancellationToken ct) {

        await using var conn = _db.CreateConnection();
        var total = await conn.ExecuteScalarAsync<decimal>(
            "SELECT total FROM orders WHERE order_id = @OrderId",
            new { OrderId = orderId },
            ct
        );

        if (amount != total) {
            throw new ValidationException(
                $"Payment amount {amount:C} does not match order total {total:C}"
            );
        }
    }

    private static void ValidatePaymentMethod(PaymentMethod method) {
        if (string.IsNullOrWhiteSpace(method.CardNumber)) {
            throw new ValidationException("Card number is required");
        }

        if (method.ExpiryDate < DateOnly.FromDateTime(DateTime.UtcNow)) {
            throw new ValidationException("Card has expired");
        }
    }
}
```

**Key Points**:
- Extract validation into private methods
- Validate early, fail fast
- Clear error messages
- Structured logging

### Pattern 4: Tuple Return with Auto-Cascade

**Use Case**: Commands that produce events alongside business results

The **auto-cascade** feature automatically publishes `IEvent` instances extracted from receptor return values. This enables a cleaner pattern where receptors return tuples containing both results and events.

```csharp
public record CreateOrder(Guid CustomerId, OrderLineItem[] Items);

public record OrderResult(Guid OrderId);

public record OrderCreated(
    [property: StreamKey] Guid OrderId,
    Guid CustomerId,
    decimal Total,
    DateTimeOffset CreatedAt
) : IEvent;

// Return tuple: (Result, Event)
public class CreateOrderReceptor : IReceptor<CreateOrder, (OrderResult, OrderCreated)> {
    private readonly ILogger<CreateOrderReceptor> _logger;

    public CreateOrderReceptor(ILogger<CreateOrderReceptor> logger) {
        _logger = logger;
    }

    public ValueTask<(OrderResult, OrderCreated)> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        // Validation
        if (message.Items.Length == 0) {
            throw new ValidationException("Order must have at least one item");
        }

        // Business logic
        var orderId = Guid.CreateVersion7();
        var total = message.Items.Sum(i => i.Quantity * i.UnitPrice);

        _logger.LogInformation(
            "Order {OrderId} created for customer {CustomerId}, total {Total:C}",
            orderId, message.CustomerId, total
        );

        // Return tuple - OrderCreated is AUTO-PUBLISHED to all perspectives!
        return ValueTask.FromResult((
            new OrderResult(orderId),
            new OrderCreated(orderId, message.CustomerId, total, DateTimeOffset.UtcNow)
        ));
    }
}
```

**Key Points**:
- Return type is `(OrderResult, OrderCreated)` tuple
- `OrderCreated` implements `IEvent` → automatically extracted and published
- `OrderResult` does not implement `IEvent` → passed through unchanged
- No explicit `_dispatcher.PublishAsync()` call needed
- All perspectives subscribing to `OrderCreated` receive the event automatically

**Benefits**:
- **Fewer dependencies**: No need to inject `IDispatcher` just for publishing
- **Cleaner code**: Return events declaratively, not imperatively
- **Safer**: Can't forget to publish events
- **Type-safe**: Compiler enforces the return contract

See [Dispatcher: Automatic Event Cascade](dispatcher.md#automatic-event-cascade) for full details on supported return types.

---

## Dependency Injection

### Constructor Injection

Receptors use **constructor injection** for dependencies:

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IDbConnectionFactory _db;
    private readonly IInventoryService _inventory;
    private readonly ILogger<CreateOrderReceptor> _logger;

    // Dependencies injected via constructor
    public CreateOrderReceptor(
        IDbConnectionFactory db,
        IInventoryService inventory,
        ILogger<CreateOrderReceptor> logger) {

        _db = db;
        _inventory = inventory;
        _logger = logger;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        // Use injected dependencies
        await using var conn = _db.CreateConnection();
        var hasStock = await _inventory.CheckStockAsync(message.Items, ct);

        // ...
    }
}
```

### Registration

**Manual Registration**:
```csharp
builder.Services.AddTransient<IReceptor<CreateOrder, OrderCreated>, CreateOrderReceptor>();
```

**Auto-Discovery** (with Whizbang.Generators):
```csharp
builder.Services.AddDiscoveredReceptors();  // Automatically finds all IReceptor implementations
```

### Lifetime

**Recommended**: `Transient` (new instance per request)

**Why?**
- May inject scoped services (e.g., `DbContext`)
- Stateless (no benefit to reusing instances)
- Minimal allocation cost

```csharp
// Correct
builder.Services.AddTransient<IReceptor<CreateOrder, OrderCreated>, CreateOrderReceptor>();

// Avoid (unless you have specific performance needs)
builder.Services.AddScoped<IReceptor<CreateOrder, OrderCreated>, CreateOrderReceptor>();
builder.Services.AddSingleton<IReceptor<CreateOrder, OrderCreated>, CreateOrderReceptor>();
```

---

## Error Handling

### Validation Errors

Use exceptions for validation failures:

```csharp
public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder message,
    CancellationToken ct = default) {

    // Early validation
    if (message.Items.Length == 0) {
        throw new ValidationException("Order must contain at least one item");
    }

    if (message.Items.Any(i => i.Quantity <= 0)) {
        throw new ValidationException("All items must have quantity greater than zero");
    }

    if (message.Items.Any(i => i.UnitPrice <= 0)) {
        throw new ValidationException("All items must have price greater than zero");
    }

    // Business logic
    // ...
}
```

**Exception Types**:
- `ValidationException` - Input validation failures (400 Bad Request)
- `NotFoundException` - Entity not found (404 Not Found)
- `InvalidOperationException` - Business rule violations (409 Conflict)
- `UnauthorizedAccessException` - Authorization failures (403 Forbidden)

### Business Logic Errors

Return error responses for expected failures:

```csharp
public record PaymentResult(
    Guid OrderId,
    decimal Amount,
    string? TransactionId,
    bool IsSuccess,
    string? ErrorCode
);

public async ValueTask<PaymentResult> HandleAsync(
    ProcessPayment message,
    CancellationToken ct = default) {

    try {
        var transactionId = await _gateway.ChargeAsync(
            message.PaymentMethod,
            message.Amount,
            ct
        );

        return new PaymentResult(
            OrderId: message.OrderId,
            Amount: message.Amount,
            TransactionId: transactionId,
            IsSuccess: true,
            ErrorCode: null
        );

    } catch (PaymentDeclinedException ex) {
        // Don't throw - return error response
        return new PaymentResult(
            OrderId: message.OrderId,
            Amount: message.Amount,
            TransactionId: null,
            IsSuccess: false,
            ErrorCode: ex.ErrorCode
        );
    }
}
```

**When to throw vs return error**:
- **Throw**: Unexpected errors, validation failures, system errors
- **Return error**: Expected business failures (payment declined, insufficient inventory)

---

## Async/Await Patterns

### ValueTask vs Task

Use `ValueTask<T>` for receptor signatures:

```csharp
// ✅ CORRECT - ValueTask<T>
public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder message,
    CancellationToken ct = default) {
    // ...
}

// ❌ WRONG - Task<T>
public async Task<OrderCreated> HandleAsync(
    CreateOrder message,
    CancellationToken ct = default) {
    // ...
}
```

**Why ValueTask?**
- Can complete synchronously (no heap allocation for sync paths)
- Can be cached/pooled
- Better performance for hot paths

### Cancellation Token

Always accept and pass `CancellationToken`:

```csharp
public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder message,
    CancellationToken ct = default) {  // Accept ct

    await using var conn = _db.CreateConnection();

    // Pass ct to all async operations
    var customer = await conn.QuerySingleOrDefaultAsync<Customer>(
        "SELECT * FROM customers WHERE customer_id = @CustomerId",
        new { message.CustomerId },
        ct  // ← Pass cancellation token
    );

    // ...
}
```

**Benefits**:
- Request cancellation support
- Graceful shutdown
- Resource cleanup

---

## Testing Receptors

### Unit Tests

Test receptors in isolation:

```csharp
public class CreateOrderReceptorTests {
    [Test]
    public async Task HandleAsync_ValidOrder_ReturnsOrderCreatedAsync() {
        // Arrange
        var logger = new NullLogger<CreateOrderReceptor>();
        var receptor = new CreateOrderReceptor(logger);

        var command = new CreateOrder(
            CustomerId: Guid.NewGuid(),
            Items: [
                new OrderLineItem(Guid.NewGuid(), 2, 19.99m),
                new OrderLineItem(Guid.NewGuid(), 1, 49.99m)
            ]
        );

        // Act
        var result = await receptor.HandleAsync(command);

        // Assert
        await Assert.That(result.OrderId).IsNotEqualTo(Guid.Empty);
        await Assert.That(result.CustomerId).IsEqualTo(command.CustomerId);
        await Assert.That(result.Items.Length).IsEqualTo(2);
        await Assert.That(result.Total).IsEqualTo(89.97m);  // (2 * 19.99) + 49.99
    }

    [Test]
    public async Task HandleAsync_EmptyItems_ThrowsValidationExceptionAsync() {
        // Arrange
        var logger = new NullLogger<CreateOrderReceptor>();
        var receptor = new CreateOrderReceptor(logger);

        var command = new CreateOrder(
            CustomerId: Guid.NewGuid(),
            Items: []  // Empty!
        );

        // Act & Assert
        await Assert.That(async () => await receptor.HandleAsync(command))
            .ThrowsException<ValidationException>()
            .WithMessage("Order must contain at least one item");
    }
}
```

### Mocking Dependencies

Use mocks for external dependencies:

```csharp
public class CancelOrderReceptorTests {
    [Test]
    public async Task HandleAsync_ExistingOrder_ReturnsOrderCancelledAsync() {
        // Arrange
        var mockDb = CreateMockDb();  // Returns mock with test data
        var logger = new NullLogger<CancelOrderReceptor>();
        var receptor = new CancelOrderReceptor(mockDb, logger);

        var command = new CancelOrder(
            OrderId: TestData.ExistingOrderId,
            Reason: "Customer request"
        );

        // Act
        var result = await receptor.HandleAsync(command);

        // Assert
        await Assert.That(result.OrderId).IsEqualTo(command.OrderId);
        await Assert.That(result.Reason).IsEqualTo("Customer request");
    }

    [Test]
    public async Task HandleAsync_NonExistentOrder_ThrowsNotFoundExceptionAsync() {
        // Arrange
        var mockDb = CreateMockDb();  // Returns null for non-existent order
        var logger = new NullLogger<CancelOrderReceptor>();
        var receptor = new CancelOrderReceptor(mockDb, logger);

        var command = new CancelOrder(
            OrderId: Guid.NewGuid(),  // Doesn't exist
            Reason: "Customer request"
        );

        // Act & Assert
        await Assert.That(async () => await receptor.HandleAsync(command))
            .ThrowsException<NotFoundException>();
    }
}
```

---

## Advanced Patterns

### Pattern: Multi-Step Validation

```csharp
public class ReserveInventoryReceptor : IReceptor<ReserveInventory, InventoryReserved> {
    private readonly IDbConnectionFactory _db;
    private readonly ILogger<ReserveInventoryReceptor> _logger;

    public async ValueTask<InventoryReserved> HandleAsync(
        ReserveInventory message,
        CancellationToken ct = default) {

        // Step 1: Validate order exists
        var order = await ValidateOrderExistsAsync(message.OrderId, ct);

        // Step 2: Check inventory levels
        var inventoryChecks = await CheckInventoryLevelsAsync(order.Items, ct);

        // Step 3: Validate all items in stock
        ValidateAllItemsInStock(inventoryChecks);

        // Step 4: Reserve inventory (business logic)
        var reservations = await CreateReservationsAsync(
            message.OrderId,
            inventoryChecks,
            ct
        );

        // Return event
        return new InventoryReserved(
            OrderId: message.OrderId,
            Reservations: reservations,
            ReservedAt: DateTimeOffset.UtcNow
        );
    }

    private async Task<Order> ValidateOrderExistsAsync(Guid orderId, CancellationToken ct) {
        await using var conn = _db.CreateConnection();
        var order = await conn.QuerySingleOrDefaultAsync<Order>(
            "SELECT * FROM orders WHERE order_id = @OrderId",
            new { OrderId = orderId },
            ct
        );

        if (order is null) {
            throw new NotFoundException($"Order {orderId} not found");
        }

        return order;
    }

    private async Task<InventoryCheck[]> CheckInventoryLevelsAsync(
        OrderLineItem[] items,
        CancellationToken ct) {

        await using var conn = _db.CreateConnection();

        var checks = new List<InventoryCheck>();

        foreach (var item in items) {
            var available = await conn.ExecuteScalarAsync<int>(
                "SELECT available_quantity FROM inventory WHERE product_id = @ProductId",
                new { ProductId = item.ProductId },
                ct
            );

            checks.Add(new InventoryCheck(
                ProductId: item.ProductId,
                RequestedQuantity: item.Quantity,
                AvailableQuantity: available
            ));
        }

        return checks.ToArray();
    }

    private static void ValidateAllItemsInStock(InventoryCheck[] checks) {
        var outOfStock = checks.Where(c => c.AvailableQuantity < c.RequestedQuantity).ToArray();

        if (outOfStock.Length > 0) {
            var productIds = string.Join(", ", outOfStock.Select(c => c.ProductId));
            throw new InsufficientInventoryException(
                $"Insufficient inventory for products: {productIds}"
            );
        }
    }

    private async Task<Reservation[]> CreateReservationsAsync(
        Guid orderId,
        InventoryCheck[] checks,
        CancellationToken ct) {

        await using var conn = _db.CreateConnection();

        var reservations = new List<Reservation>();

        foreach (var check in checks) {
            await conn.ExecuteAsync(
                "UPDATE inventory SET available_quantity = available_quantity - @Quantity WHERE product_id = @ProductId",
                new { ProductId = check.ProductId, Quantity = check.RequestedQuantity },
                ct
            );

            reservations.Add(new Reservation(
                ProductId: check.ProductId,
                Quantity: check.RequestedQuantity
            ));
        }

        return reservations.ToArray();
    }
}

internal record InventoryCheck(
    Guid ProductId,
    int RequestedQuantity,
    int AvailableQuantity
);
```

### Pattern: Saga Coordination

```csharp
public class CompleteOrderReceptor : IReceptor<CompleteOrder, OrderCompleted> {
    private readonly IDispatcher _dispatcher;
    private readonly ILogger<CompleteOrderReceptor> _logger;

    public async ValueTask<OrderCompleted> HandleAsync(
        CompleteOrder message,
        CancellationToken ct = default) {

        // Step 1: Reserve inventory
        var inventoryResult = await _dispatcher.LocalInvokeAsync<ReserveInventory, InventoryReserved>(
            new ReserveInventory(message.OrderId),
            ct
        );

        try {
            // Step 2: Process payment
            var paymentResult = await _dispatcher.LocalInvokeAsync<ProcessPayment, PaymentResult>(
                new ProcessPayment(message.OrderId, message.Amount, message.PaymentMethod),
                ct
            );

            if (!paymentResult.IsSuccess) {
                // Compensate: Release inventory
                await _dispatcher.LocalInvokeAsync<ReleaseInventory, InventoryReleased>(
                    new ReleaseInventory(message.OrderId),
                    ct
                );

                throw new PaymentFailedException($"Payment declined: {paymentResult.ErrorCode}");
            }

            // Step 3: Create shipment
            var shipmentResult = await _dispatcher.LocalInvokeAsync<CreateShipment, ShipmentCreated>(
                new CreateShipment(message.OrderId),
                ct
            );

            return new OrderCompleted(
                OrderId: message.OrderId,
                CompletedAt: DateTimeOffset.UtcNow
            );

        } catch {
            // Compensate: Release inventory if anything fails
            await _dispatcher.LocalInvokeAsync<ReleaseInventory, InventoryReleased>(
                new ReleaseInventory(message.OrderId),
                ct
            );

            throw;
        }
    }
}
```

---

## Best Practices

### DO ✅

- ✅ Keep receptors **stateless** (no instance fields except injected dependencies)
- ✅ Use **constructor injection** for dependencies
- ✅ Validate early, fail fast
- ✅ Return **events** for commands (facts of what happened)
- ✅ Use **ValueTask<T>** for HandleAsync
- ✅ Always pass **CancellationToken** to async operations
- ✅ Log important decisions and errors
- ✅ Test receptors in isolation
- ✅ Extract complex validation into private methods
- ✅ Use **Guid.CreateVersion7()** for IDs (time-ordered)

### DON'T ❌

- ❌ Store state in instance fields (except injected dependencies)
- ❌ Call other receptors directly (use Dispatcher)
- ❌ Perform long-running operations (offload to background workers)
- ❌ Catch and suppress exceptions without logging
- ❌ Return null (throw exception or return error response)
- ❌ Mix read and write logic (use separate receptors)
- ❌ Ignore CancellationToken
- ❌ Use Guid.NewGuid() (use Guid.CreateVersion7() for time-ordering)

---

## Further Reading

**Core Concepts**:
- [Dispatcher](dispatcher.md) - How to invoke receptors
- [Perspectives](perspectives.md) - Event listeners for read models
- [Message Context](message-context.md) - Correlation and causation tracking

**Messaging Patterns**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable event publishing
- [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once processing

**Testing**:
- [Receptor Testing](../testing/receptor-testing.md) - Comprehensive testing guide

**Examples**:
- [ECommerce: Order Service](../examples/ecommerce/order-service.md) - Real-world receptor patterns

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
