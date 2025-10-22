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

```csharp{
title: "K&R/Egyptian Brace Style"
description: "Correct vs incorrect brace placement"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Code Style", "Braces"]
nugetPackages: []
usingStatements: []
showLineNumbers: false
}
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

```csharp{
title: "Type Naming Conventions"
description: "PascalCase for types with I-prefix for interfaces"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Naming", "Types"]
nugetPackages: []
usingStatements: ["System"]
showLineNumbers: false
}
public class OrderProcessor { }
public interface IOrderRepository { }
public record OrderPlaced(Guid OrderId);
public enum OrderStatus { Placed, Shipped }
```

**I-prefix** for interfaces:

```csharp{
title: "Interface Naming"
description: "I-prefix for all interfaces"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Naming", "Interfaces"]
nugetPackages: []
usingStatements: []
showLineNumbers: false
}
public interface IEventStore { }
public interface IProjection { }
```

### Methods and Properties

**PascalCase**:

```csharp{
title: "Method and Property Naming"
description: "PascalCase for public methods and properties"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Naming", "Methods", "Properties"]
nugetPackages: []
usingStatements: ["System"]
showLineNumbers: false
}
public class Order {
    public Guid Id { get; private set; }
    public decimal Total { get; private set; }

    public void Ship(string trackingNumber) {
        // ...
    }
}
```

**Async suffix** for async methods:

```csharp{
title: "Async Method Naming"
description: "Async suffix for asynchronous methods"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Naming", "Async", "Methods"]
nugetPackages: []
usingStatements: ["System", "System.Threading.Tasks"]
showLineNumbers: false
}
public async Task<Order> GetOrderAsync(Guid orderId) {
    // ...
}

public async Task SaveAsync(Order order) {
    // ...
}
```

### Parameters and Local Variables

**camelCase**:

```csharp{
title: "Parameter and Variable Naming"
description: "camelCase for parameters and local variables"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Naming", "Variables", "Parameters"]
nugetPackages: []
usingStatements: ["System", "System.Collections.Generic", "System.Linq"]
showLineNumbers: false
}
public void ProcessOrder(Guid orderId, List<OrderItem> items) {
    var total = items.Sum(i => i.Price * i.Quantity);
    var customerId = GetCustomerId(orderId);
}
```

### Fields

**`_camelCase`** (underscore prefix) for private fields:

```csharp{
title: "Field Naming"
description: "_camelCase with underscore prefix for private fields"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Naming", "Fields"]
nugetPackages: []
usingStatements: ["Microsoft.Extensions.Logging"]
showLineNumbers: false
}
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

```csharp{
title: "Constant Naming"
description: "ALL_CAPS with underscores for constants"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Naming", "Constants"]
nugetPackages: []
usingStatements: []
showLineNumbers: false
}
public class EventStoreConstants {
    public const string DEFAULT_STREAM_PREFIX = "whizbang-";
    public const int MAX_BATCH_SIZE = 1000;
}
```

## `var` Keyword

**Always use `var`** for local variables when the type is obvious:

```csharp{
title: "var Keyword Usage"
description: "Always use var when type is obvious"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["var", "Code Style"]
nugetPackages: ["Microsoft.Extensions.DependencyInjection"]
usingStatements: ["System.Linq", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: false
}
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

```csharp{
title: "Explicit Type When Helpful"
description: "Use explicit type when it aids clarity"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["var", "Code Style"]
nugetPackages: []
usingStatements: ["System.Collections.Generic", "System.Linq"]
showLineNumbers: false
}
// OK - explicit type makes intent clear
IEnumerable<Order> activeOrders = GetOrders().Where(o => o.IsActive);
```

## File-Scoped Namespaces

**Always use file-scoped namespaces** (C# 10+):

```csharp{
title: "File-Scoped Namespaces"
description: "Always use file-scoped namespaces (C# 10+)"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Namespaces", "Code Style"]
nugetPackages: ["Whizbang"]
usingStatements: ["System", "Whizbang"]
showLineNumbers: false
}
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

```csharp{
title: "Using Directives Placement"
description: "Place outside namespace, System directives first"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Using", "Code Style"]
nugetPackages: ["Microsoft.Extensions.DependencyInjection", "Whizbang"]
usingStatements: ["System", "System.Collections.Generic", "System.Threading.Tasks", "Microsoft.Extensions.DependencyInjection", "Whizbang"]
showLineNumbers: false
}
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

```csharp{
title: "Records for DTOs and Events"
description: "Use records for immutable data"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Records", "Immutability", "Events"]
nugetPackages: []
usingStatements: ["System", "System.Collections.Generic"]
showLineNumbers: false
}
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

```csharp{
title: "Nullable Reference Types"
description: "Annotate nullability explicitly"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Nullable", "Type Safety"]
nugetPackages: []
usingStatements: ["System", "System.Threading.Tasks"]
showLineNumbers: false
}
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

```csharp{
title: "Specific Exception Types"
description: "Throw specific exceptions, not generic Exception"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Exceptions", "Error Handling"]
nugetPackages: []
usingStatements: ["System"]
showLineNumbers: false
}
// ✅ CORRECT
throw new OrderNotFoundException(orderId);
throw new InvalidOperationException("Cannot ship a cancelled order");

// ❌ WRONG
throw new Exception("Order not found");
```

### Don't Swallow Exceptions

```csharp{
title: "Proper Exception Handling"
description: "Don't swallow exceptions, re-throw when needed"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Exceptions", "Error Handling", "Logging"]
nugetPackages: ["Microsoft.Extensions.Logging"]
usingStatements: ["System.Threading.Tasks", "Microsoft.Extensions.Logging"]
showLineNumbers: false
}
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

```csharp{
title: "Specific Exception Catches"
description: "Catch specific exceptions, not everything"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Exceptions", "Error Handling"]
nugetPackages: ["Microsoft.EntityFrameworkCore", "Microsoft.Extensions.Logging"]
usingStatements: ["System", "System.Threading.Tasks", "Microsoft.EntityFrameworkCore", "System.Data.Common", "Microsoft.Extensions.Logging"]
showLineNumbers: false
}
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

```csharp{
title: "Async All the Way"
description: "Always use async all the way through the call stack"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Async", "Threading"]
nugetPackages: []
usingStatements: ["System", "System.Threading.Tasks"]
showLineNumbers: false
}
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

```csharp{
title: "ConfigureAwait in Libraries"
description: "Use ConfigureAwait(false) in library code"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Async", "ConfigureAwait", "Libraries"]
nugetPackages: []
usingStatements: ["System.Threading.Tasks"]
showLineNumbers: false
}
// ✅ CORRECT - library code
public async Task SaveAsync(Order order) {
    var events = order.GetUncommittedEvents();
    await _eventStore.AppendAsync(streamId, events).ConfigureAwait(false);
}

// Application code can omit ConfigureAwait
```

## AOT Compatibility

**Never use reflection that breaks AOT**:

```csharp{
title: "AOT-Safe Code"
description: "Avoid reflection that breaks native AOT"
framework: "NET8"
category: "Contributors"
difficulty: "ADVANCED"
tags: ["AOT", "Reflection", "Source Generators"]
nugetPackages: []
usingStatements: ["System"]
showLineNumbers: false
}
// ❌ WRONG - breaks AOT
var type = Type.GetType("MyApp.Orders.Order");
var instance = Activator.CreateInstance(type);

// ✅ CORRECT - use source generators
[GenerateHandlers]  // Source generator creates handler registry
public partial class HandlerRegistry { }
```

**Use generic constraints instead of runtime type checks**:

```csharp{
title: "Generic Constraints vs Runtime Checks"
description: "Use generic constraints instead of runtime type checks"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Generics", "Type Safety", "AOT"]
nugetPackages: []
usingStatements: ["System"]
showLineNumbers: false
}
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

```csharp{
title: "Constructor Injection"
description: "Use constructor injection, not property injection"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Dependency Injection", "Constructor"]
nugetPackages: []
usingStatements: []
showLineNumbers: false
}
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

```csharp{
title: "Explicit Service Registration"
description: "Register services explicitly, avoid magic scanning"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Dependency Injection", "AOT", "Service Registration"]
nugetPackages: ["Microsoft.Extensions.DependencyInjection"]
usingStatements: ["Microsoft.Extensions.DependencyInjection"]
showLineNumbers: false
}
// ✅ CORRECT - explicit registration
services.AddScoped<IOrderRepository, OrderRepository>();
services.AddSingleton<IEventStore, PostgresEventStore>();

// ❌ WRONG - magic scanning that breaks AOT
services.Scan(scan => scan.FromAssemblyOf<Order>().AddClasses().AsImplementedInterfaces());
```

## Performance

### Use ValueTask for Hot Paths

```csharp{
title: "ValueTask for Hot Paths"
description: "Use ValueTask for high-frequency methods"
framework: "NET8"
category: "Contributors"
difficulty: "ADVANCED"
tags: ["Performance", "ValueTask", "Hot Path"]
nugetPackages: []
usingStatements: ["System.Threading.Tasks"]
showLineNumbers: false
}
// ✅ CORRECT - high-frequency method
public ValueTask<bool> TryGetFromCacheAsync(string key) {
    if (_cache.TryGetValue(key, out var value)) {
        return new ValueTask<bool>(true);  // Synchronous completion
    }
    return LoadFromDatabaseAsync(key);  // Async completion
}
```

### Avoid Allocations in Hot Paths

```csharp{
title: "Avoid Allocations in Hot Paths"
description: "Use Span/Memory to avoid allocations"
framework: "NET8"
category: "Contributors"
difficulty: "ADVANCED"
tags: ["Performance", "Memory", "Span", "Hot Path"]
nugetPackages: []
usingStatements: ["System"]
showLineNumbers: false
}
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

```csharp{
title: "Test Method Naming Convention"
description: "MethodName_Scenario_ExpectedBehavior format"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Testing", "Naming", "xUnit"]
nugetPackages: ["xunit", "FluentAssertions"]
usingStatements: ["Xunit", "FluentAssertions", "System"]
showLineNumbers: false
}
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

```csharp{
title: "FluentAssertions vs xUnit Asserts"
description: "Use FluentAssertions for better readability"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Testing", "FluentAssertions", "xUnit"]
nugetPackages: ["FluentAssertions", "xunit"]
usingStatements: ["FluentAssertions", "Xunit"]
showLineNumbers: false
}
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

```csharp{
title: "Meaningful Comments"
description: "Explain why, not what - focus on non-obvious decisions"
framework: "NET8"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Comments", "Documentation"]
nugetPackages: []
usingStatements: ["System.Threading.Tasks"]
showLineNumbers: false
}
// ✅ CORRECT - explains non-obvious decision
// Use pessimistic locking here because optimistic concurrency
// causes too many retries under high contention
await _connection.ExecuteAsync("SELECT ... FOR UPDATE");

// ❌ WRONG - states the obvious
// Get the order
var order = await GetOrderAsync(orderId);
```

### XML Documentation for Public APIs

```csharp{
title: "XML Documentation for Public APIs"
description: "Document all public APIs with XML comments"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Documentation", "XML Comments", "API"]
nugetPackages: []
usingStatements: ["System.Collections.Generic", "System.Threading.Tasks"]
showLineNumbers: false
}
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

```csharp{
title: "Analyzer Warning Suppression"
description: "Suppress warnings only when absolutely necessary with justification"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Analyzers", "Warnings", "Code Quality"]
nugetPackages: []
usingStatements: []
showLineNumbers: false
}
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
