---
title: Coding Standards
category: Contributors
order: 2
tags: code-style, conventions, c-sharp, best-practices
---

# Coding Standards

Whizbang follows strict coding standards to ensure consistency, maintainability, and AOT compatibility.

## EditorConfig

All code MUST follow the [`.editorconfig`](https://github.com/whizbang-lib/whizbang/blob/main/.editorconfig) rules in the repository.

Documentation examples follow [`CODE_SAMPLES.editorconfig`](../CODE_SAMPLES.editorconfig).

## C# Version

- **Minimum**: C# 12
- **Target**: Latest stable C# version
- Use modern language features (pattern matching, records, file-scoped namespaces, etc.)

## Brace Style

**Use K&R/Egyptian braces** (opening brace on same line):

```csharp
// ✅ CORRECT - K&R/Egyptian style
public class Order {
    public void Ship() {
        if (Status == OrderStatus.Placed) {
            Status = OrderStatus.Shipped;
        }
    }
}

// ❌ WRONG - Allman style
public class Order
{
    public void Ship()
    {
        if (Status == OrderStatus.Placed)
        {
            Status = OrderStatus.Shipped;
        }
    }
}
```

## Naming Conventions

### Types

**PascalCase** for classes, interfaces, records, enums, structs:

```csharp
public class OrderProcessor { }
public interface IOrderRepository { }
public record OrderPlaced(Guid OrderId);
public enum OrderStatus { Placed, Shipped }
```

**I-prefix** for interfaces:

```csharp
public interface IEventStore { }
public interface IProjection { }
```

### Methods and Properties

**PascalCase**:

```csharp
public class Order {
    public Guid Id { get; private set; }
    public decimal Total { get; private set; }

    public void Ship(string trackingNumber) {
        // ...
    }
}
```

**Async suffix** for async methods:

```csharp
public async Task<Order> GetOrderAsync(Guid orderId) {
    // ...
}

public async Task SaveAsync(Order order) {
    // ...
}
```

### Parameters and Local Variables

**camelCase**:

```csharp
public void ProcessOrder(Guid orderId, List<OrderItem> items) {
    var total = items.Sum(i => i.Price * i.Quantity);
    var customerId = GetCustomerId(orderId);
}
```

### Fields

**`_camelCase`** (underscore prefix) for private fields:

```csharp
public class OrderProcessor {
    private readonly IOrderRepository _repository;
    private readonly ILogger _logger;

    public OrderProcessor(IOrderRepository repository, ILogger logger) {
        _repository = repository;
        _logger = logger;
    }
}
```

### Constants

**ALL_CAPS** with underscores:

```csharp
public class EventStoreConstants {
    public const string DEFAULT_STREAM_PREFIX = "whizbang-";
    public const int MAX_BATCH_SIZE = 1000;
}
```

## `var` Keyword

**Always use `var`** for local variables when the type is obvious:

```csharp
// ✅ CORRECT
var order = new Order(customerId, items);
var total = items.Sum(i => i.Price);
var repository = serviceProvider.GetRequiredService<IOrderRepository>();

// ❌ WRONG
Order order = new Order(customerId, items);
decimal total = items.Sum(i => i.Price);
IOrderRepository repository = serviceProvider.GetRequiredService<IOrderRepository>();
```

Exception: Use explicit type when it aids clarity:

```csharp
// OK - explicit type makes intent clear
IEnumerable<Order> activeOrders = GetOrders().Where(o => o.IsActive);
```

## File-Scoped Namespaces

**Always use file-scoped namespaces** (C# 10+):

```csharp
// ✅ CORRECT
using System;
using Whizbang;

namespace MyApp.Orders;

public class Order {
    // ...
}

// ❌ WRONG
using System;
using Whizbang;

namespace MyApp.Orders {
    public class Order {
        // ...
    }
}
```

## Using Directives

**Place outside namespace, `System` directives first**:

```csharp
// ✅ CORRECT
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Whizbang;

namespace MyApp.Orders;

public class OrderService {
    // ...
}

// ❌ WRONG - using inside namespace
namespace MyApp.Orders {
    using System;
    using Whizbang;

    public class OrderService {
        // ...
    }
}
```

## Records for DTOs and Events

Use **records** for immutable data:

```csharp
// ✅ CORRECT - Events as records
public record OrderPlaced(Guid OrderId, Guid CustomerId, DateTimeOffset PlacedAt);

public record PlaceOrder(Guid CustomerId, List<OrderItem> Items);

// ❌ WRONG - Events as classes with setters
public class OrderPlaced {
    public Guid OrderId { get; set; }
    public Guid CustomerId { get; set; }
    public DateTimeOffset PlacedAt { get; set; }
}
```

## Nullable Reference Types

**Enable nullable reference types** in all projects:

```xml
<PropertyGroup>
    <Nullable>enable</Nullable>
</PropertyGroup>
```

**Annotate nullability explicitly**:

```csharp
public class OrderRepository {
    // Non-nullable - must never be null
    private readonly IEventStore _eventStore;

    // Nullable - can be null
    private Order? _cachedOrder;

    public async Task<Order?> FindAsync(Guid orderId) {
        // Returns null if not found
        return await _eventStore.LoadAsync<Order>(orderId);
    }

    public async Task<Order> GetAsync(Guid orderId) {
        // Throws if not found (non-nullable return)
        var order = await FindAsync(orderId);
        return order ?? throw new OrderNotFoundException(orderId);
    }
}
```

## Exception Handling

### Throw Specific Exceptions

```csharp
// ✅ CORRECT
throw new OrderNotFoundException(orderId);
throw new InvalidOperationException("Cannot ship a cancelled order");

// ❌ WRONG
throw new Exception("Order not found");
```

### Don't Swallow Exceptions

```csharp
// ✅ CORRECT
try {
    await processor.ProcessAsync(order);
} catch (InvalidOrderException ex) {
    _logger.LogError(ex, "Order validation failed: {OrderId}", order.Id);
    throw;  // Re-throw to propagate
}

// ❌ WRONG
try {
    await processor.ProcessAsync(order);
} catch {
    // Silent failure - very bad!
}
```

### Use Specific Catches

```csharp
// ✅ CORRECT
try {
    await SaveAsync(order);
} catch (DbUpdateConcurrencyException ex) {
    throw new OptimisticConcurrencyException("Order was modified", ex);
} catch (DbException ex) {
    _logger.LogError(ex, "Database error saving order");
    throw;
}

// ❌ WRONG - catching everything
try {
    await SaveAsync(order);
} catch (Exception ex) {
    _logger.LogError(ex, "Error");
    throw;
}
```

## Async/Await

### Always Async All the Way

```csharp
// ✅ CORRECT
public async Task<Order> GetOrderAsync(Guid orderId) {
    var events = await _eventStore.LoadStreamAsync($"Order-{orderId}");
    return await ReconstructAsync(events);
}

// ❌ WRONG - mixing sync and async
public Order GetOrder(Guid orderId) {
    var events = _eventStore.LoadStreamAsync($"Order-{orderId}").Result;  // Deadlock risk!
    return ReconstructAsync(events).Result;
}
```

### Use ConfigureAwait(false) in Libraries

```csharp
// ✅ CORRECT - library code
public async Task SaveAsync(Order order) {
    var events = order.GetUncommittedEvents();
    await _eventStore.AppendAsync(streamId, events).ConfigureAwait(false);
}

// Application code can omit ConfigureAwait
```

## AOT Compatibility

**Never use reflection that breaks AOT**:

```csharp
// ❌ WRONG - breaks AOT
var type = Type.GetType("MyApp.Orders.Order");
var instance = Activator.CreateInstance(type);

// ✅ CORRECT - use source generators
[GenerateHandlers]  // Source generator creates handler registry
public partial class HandlerRegistry { }
```

**Use generic constraints instead of runtime type checks**:

```csharp
// ❌ WRONG
public void Process(object message) {
    if (message.GetType() == typeof(PlaceOrder)) {
        // ...
    }
}

// ✅ CORRECT
public void Process<TMessage>(TMessage message) where TMessage : class {
    // Compile-time type safety
}
```

## Dependency Injection

### Constructor Injection

```csharp
// ✅ CORRECT
public class OrderService {
    private readonly IOrderRepository _repository;
    private readonly IEventPublisher _publisher;

    public OrderService(IOrderRepository repository, IEventPublisher publisher) {
        _repository = repository;
        _publisher = publisher;
    }
}

// ❌ WRONG - property injection
public class OrderService {
    public IOrderRepository Repository { get; set; }
}
```

### Register Services Explicitly

```csharp
// ✅ CORRECT - explicit registration
services.AddScoped<IOrderRepository, OrderRepository>();
services.AddSingleton<IEventStore, PostgresEventStore>();

// ❌ WRONG - magic scanning that breaks AOT
services.Scan(scan => scan.FromAssemblyOf<Order>().AddClasses().AsImplementedInterfaces());
```

## Performance

### Use ValueTask for Hot Paths

```csharp
// ✅ CORRECT - high-frequency method
public ValueTask<bool> TryGetFromCacheAsync(string key) {
    if (_cache.TryGetValue(key, out var value)) {
        return new ValueTask<bool>(true);  // Synchronous completion
    }
    return LoadFromDatabaseAsync(key);  // Async completion
}
```

### Avoid Allocations in Hot Paths

```csharp
// ✅ CORRECT - reuse span/memory
public void ProcessEvents(ReadOnlySpan<Event> events) {
    foreach (var @event in events) {
        // Process without allocation
    }
}

// ❌ WRONG - allocates array
public void ProcessEvents(Event[] events) {
    // ...
}
```

## Testing Conventions

### Test Method Naming

**Format**: `MethodName_Scenario_ExpectedBehavior`

```csharp
[Fact]
public void Ship_WhenOrderIsPlaced_UpdatesStatusToShipped() {
    // Arrange
    var order = new Order(customerId, items);

    // Act
    order.Ship(trackingNumber);

    // Assert
    order.Status.Should().Be(OrderStatus.Shipped);
}

[Fact]
public void Ship_WhenOrderIsCancelled_ThrowsInvalidOperationException() {
    // Arrange
    var order = new Order(customerId, items);
    order.Cancel("Customer requested");

    // Act & Assert
    var act = () => order.Ship(trackingNumber);
    act.Should().Throw<InvalidOperationException>();
}
```

### Use FluentAssertions

```csharp
// ✅ CORRECT - readable assertions
result.Should().NotBeNull();
result.OrderId.Should().Be(expectedId);
result.Items.Should().HaveCount(2);

// ❌ WRONG - xUnit asserts (less readable)
Assert.NotNull(result);
Assert.Equal(expectedId, result.OrderId);
Assert.Equal(2, result.Items.Count);
```

## Comments

### Explain Why, Not What

```csharp
// ✅ CORRECT - explains non-obvious decision
// Use pessimistic locking here because optimistic concurrency
// causes too many retries under high contention
await _connection.ExecuteAsync("SELECT ... FOR UPDATE");

// ❌ WRONG - states the obvious
// Get the order
var order = await GetOrderAsync(orderId);
```

### XML Documentation for Public APIs

```csharp
/// <summary>
/// Appends events to an aggregate stream with optimistic concurrency.
/// </summary>
/// <param name="streamId">The unique identifier for the event stream.</param>
/// <param name="events">The events to append.</param>
/// <param name="expectedVersion">
/// The expected current version of the stream. If the actual version
/// does not match, throws <see cref="ConcurrencyException"/>.
/// </param>
/// <exception cref="ConcurrencyException">
/// Thrown when the stream has been modified since it was loaded.
/// </exception>
public async Task AppendAsync(string streamId, IEnumerable<object> events, long expectedVersion) {
    // ...
}
```

## Analyzer Configuration

Whizbang uses Roslyn analyzers to enforce standards. Key rules:

- **WBZ001**: Command/event must have `[OwnedBy]` attribute
- **WBZ002**: Handler marked `[Pure]` must not have side effects
- **WBZ003**: Async method must have `Async` suffix
- **WBZ004**: Event must be immutable (record or readonly properties)

Suppress warnings only when absolutely necessary:

```csharp
#pragma warning disable WBZ001 // Justification: Internal command, ownership not needed
public record InternalCleanupCommand();
#pragma warning restore WBZ001
```

## Summary Checklist

Before submitting code, verify:

- [ ] K&R/Egyptian braces used
- [ ] `var` used for local variables
- [ ] File-scoped namespaces
- [ ] Nullable reference types enabled and annotated
- [ ] Async methods have `Async` suffix
- [ ] No reflection that breaks AOT
- [ ] All public APIs have XML documentation
- [ ] Tests follow naming convention
- [ ] Code passes all analyzer rules

## Questions?

If you're unsure about any convention, ask in [GitHub Discussions](https://github.com/whizbang-lib/whizbang/discussions)!
