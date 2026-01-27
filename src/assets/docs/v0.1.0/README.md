---
title: Version 0.1.0 - Foundation Release
category: Implementation
order: 1
description: The foundation release of Whizbang establishing all core components with comprehensive testing and IDE support
tags: v0.1.0, foundation, implementation
---

# Version 0.1.0 - Foundation Release

## Overview

Version 0.1.0 is the foundation release of Whizbang, establishing a **complete skeleton** of all major components with in-memory implementations. This version prioritizes breadth over depth, ensuring every component exists and works together from day one.

## Release Goals

### Primary Goals
1. **Complete Component Set**: All 8 core components implemented and working
2. **Zero Reflection**: Everything wired via source generators
3. **IDE Integration**: Full developer experience from day one
4. **Testing Foundation**: Comprehensive testing with TUnit and Bogus
5. **In-Memory Everything**: Fast development and testing cycle

### Success Criteria
- ✅ All components have basic working implementations
- ✅ Source generators discover and wire all handlers
- ✅ IDE tools provide navigation and traceability
- ✅ Testing framework with scenario generation
- ✅ 100% test coverage of public APIs
- ✅ < 1ms in-memory operation performance

## What's Included

### Core Components
- **[Dispatcher](components/dispatcher.md)** - Message routing and coordination
- **[Receptors](components/receptors.md)** - Command receivers (stateless)
- **[Perspectives](components/perspectives.md)** - Event handlers
- **[Lenses](components/lenses.md)** - Query interfaces
- **[Policy Engine](components/policy-engine.md)** - Cross-cutting concerns
- **[Ledger](components/ledger.md)** - Event store interface
- **[Drivers](components/drivers.md)** - Storage abstraction
- **[Transports](components/transports.md)** - Message broker abstraction

### Developer Experience
- **[Source Generators](developer-experience/source-generators.md)** - Zero-reflection handler discovery
- **[Analyzers](developer-experience/analyzers.md)** - Compile-time validation
- **[IDE Tools](developer-experience/ide-tools.md)** - CodeLens-style references
- **[Traceability](developer-experience/traceability.md)** - Message flow visualization
- **[Debugging](developer-experience/codelens.md)** - Time-travel debugging foundation

### Testing Foundation
- **[Testing Strategy](testing/foundation.md)** - Overall testing approach
- **[TUnit Integration](testing/tunit.md)** - Modern test framework
- **[Bogus Scenarios](testing/bogus.md)** - Realistic data generation
- **[Behavior Specs](testing/behavior-specs.md)** - BDD-style testing
- **[Test Doubles](testing/test-doubles.md)** - In-memory mocking

## Quick Start

### Installation

```bash
dotnet add package Whizbang.Core --version 0.1.0
```

### Basic Usage

```csharp
using Whizbang;

// 1. Define a command
public record CreateOrder(Guid CustomerId, List<OrderItem> Items);

// 2. Define a receptor
[WhizbangHandler]
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public async Task<OrderCreated> Receive(CreateOrder cmd) {
        // Validation and business logic
        if (cmd.Items.Count == 0) {
            throw new InvalidOperationException("Order must have items");
        }
        
        // Emit event
        return new OrderCreated(Guid.NewGuid(), cmd.CustomerId, cmd.Items);
    }
}

// 3. Define perspectives
[WhizbangHandler]
public class OrderPerspective : IPerspectiveOf<OrderCreated> {
    private readonly Dictionary<Guid, Order> _orders = new();
    
    public Task Update(OrderCreated e) {
        _orders[e.OrderId] = new Order {
            Id = e.OrderId,
            CustomerId = e.CustomerId,
            Items = e.Items
        };
        return Task.CompletedTask;
    }
}

// 4. Define a lens
public interface IOrderLens : ILens {
    Order Focus(Guid orderId);
    IEnumerable<Order> ViewByCustomer(Guid customerId);
}

[WhizbangLens]
public class OrderLens : IOrderLens {
    private readonly Dictionary<Guid, Order> _orders;
    
    public Order Focus(Guid orderId) => _orders[orderId];
    
    public IEnumerable<Order> ViewByCustomer(Guid customerId) =>
        _orders.Values.Where(o => o.CustomerId == customerId);
}

// 5. Configure and use
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddWhizbang(options => {
    options.RegisterGeneratedHandlers();  // Source-generated registration
    options.UseInMemory();                // In-memory implementations
    options.EnableTraceability();         // IDE tools and debugging
});

var app = builder.Build();

// 6. Use via dispatcher
app.MapPost("/orders", async (CreateOrder cmd, IDispatcher dispatcher) => {
    var result = await dispatcher.Send(cmd);
    return Results.Ok(result);
});

app.MapGet("/orders/{id}", (Guid id, IDispatcher dispatcher) => {
    var lens = dispatcher.GetLens<IOrderLens>();
    var order = lens.Focus(id);
    return Results.Ok(order);
});
```

## IDE Features

### CodeLens References
```csharp
// IDE shows: "2 handlers | 1 perspective | Last: 50ms ago"
public record OrderCreated(Guid OrderId, Guid CustomerId);  

// IDE shows: "Handles: CreateOrder | Publishes: OrderCreated"
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> { }
```

### Traceability Overlay
- See message flow inline in the editor
- Visualize command → receptor → event → perspective chains
- Click to navigate between components
- View execution timings and counts

### Analyzer Warnings
```csharp
// Warning WB0001: Command 'CancelOrder' has no handler
public record CancelOrder(Guid OrderId);  // Squiggly line here

// Quick Fix: Generate handler for CancelOrder (Ctrl+.)
```

## Testing Example

```csharp
[TestClass]
public class OrderTests : WhizbangTestBase {
    [Test]
    [MethodDataSource(nameof(OrderScenarios))]
    public async Task CreateOrder_ShouldEmitOrderCreated(OrderScenario scenario) {
        // Arrange
        var dispatcher = CreateDispatcher();
        
        // Act
        var result = await dispatcher.Send(scenario.Command);
        
        // Assert
        await Verify.Event<OrderCreated>()
            .WithCustomerId(scenario.CustomerId)
            .WasPublished();
    }
    
    public static IEnumerable<OrderScenario> OrderScenarios() {
        var faker = new OrderScenarioFaker();
        yield return faker.Generate();  // Happy path
        yield return faker.WithNoItems().Generate();  // Error case
        yield return faker.WithManyItems(100).Generate();  // Stress case
    }
}
```

## Performance Characteristics

### In-Memory Performance
| Operation | Target | Actual |
|-----------|--------|--------|
| Message Dispatch | < 1μs | TBD |
| Handler Invocation | < 100ns | TBD |
| Event Publishing | < 1μs | TBD |
| Lens Query | < 1ms | TBD |
| Policy Application | < 10μs | TBD |

### Memory Allocation
- Zero allocations in dispatch hot path
- Pooled objects for messages
- Minimal GC pressure

## Migration Path

### To v0.2.0
Version 0.2.0 enhances existing components without breaking changes:
- Receptors gain validation attributes
- Perspectives support batch updates
- Lenses add pagination
- Policies become composable

See [v0.2.0 Migration Guide](../v0.2.0/migration-guide.md)

## Known Limitations

As a foundation release, v0.1.0 has intentional limitations:
- **In-Memory Only**: No persistent storage yet
- **Stateless Receptors**: No event sourcing support
- **Basic Policies**: Limited to Retry, Timeout, Cache, CircuitBreaker
- **Single Node**: No distributed messaging
- **No Sagas**: Long-running processes not supported

These limitations are addressed in subsequent versions while maintaining backward compatibility.

## Examples

### Complete Examples
- **[Basic Receptor](examples/basic-receptor.md)** - Simple command handling
- **[Policy Usage](examples/policy-usage.md)** - Applying policies to handlers
- **[Test Scenario](examples/test-scenario.md)** - Testing with Bogus

## Component Documentation

### Core Components
- [Dispatcher](components/dispatcher.md)
- [Receptors](components/receptors.md)
- [Perspectives](components/perspectives.md)
- [Lenses](components/lenses.md)
- [Policy Engine](components/policy-engine.md)
- [Ledger](components/ledger.md)
- [Drivers](components/drivers.md)
- [Transports](components/transports.md)

### Developer Experience
- [Source Generators](developer-experience/source-generators.md)
- [Analyzers](developer-experience/analyzers.md)
- [IDE Tools](developer-experience/ide-tools.md)
- [Traceability](developer-experience/traceability.md)

### Testing
- [Testing Foundation](testing/foundation.md)
- [TUnit Integration](testing/tunit.md)
- [Bogus Scenarios](testing/bogus.md)
- [Behavior Specs](testing/behavior-specs.md)

## Feedback

This is the foundation release - your feedback shapes the future:
- Report issues: https://github.com/whizbang-lib/whizbang/issues
- Join discussions: https://github.com/whizbang-lib/whizbang/discussions
- Contribute: See [Contributing Guide](../contributing.md)