# Topic Filters

Topic Filters provide type-safe, compile-time routing configuration for commands in message-based architectures. They enable declarative topic assignment using attributes with support for both string literals and strongly-typed enums.

## Overview

Topic filters allow you to declare which topics or queues your commands should be routed to without writing imperative routing code. The filter strings are extracted at compile time via source generation, enabling zero-reflection AOT-compatible routing.

### Characteristics

- **Declarative**: Define routing via attributes on command types
- **Type-safe**: Use enums with `[Description]` attributes for centralized topic definitions
- **Compile-time**: Filter extraction via Roslyn source generators (zero reflection)
- **Multiple filters**: Support multiple topics per command via `AllowMultiple = true`
- **Inheritance support**: Derive custom attributes from `TopicFilterAttribute`
- **AOT compatible**: Generated code works with Native AOT compilation

## TopicFilterAttribute

### String-Based Filters

Use string literals for simple, ad-hoc topic assignment:

```csharp
using Whizbang.Core;

namespace MyApp.Commands;

[TopicFilter("orders.create")]
public record CreateOrderCommand : ICommand {
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
}

[TopicFilter("payments.process")]
public record ProcessPaymentCommand : ICommand {
  public required Guid OrderId { get; init; }
  public required decimal Amount { get; init; }
}
```

### Enum-Based Filters

For centralized, type-safe topic definitions, use enums with `[Description]` attributes:

```csharp
using System.ComponentModel;
using Whizbang.Core;

namespace MyApp.Commands;

// Centralized topic definitions
public enum ServiceBusTopics {
  [Description("orders.created")]
  OrdersCreated,

  [Description("orders.cancelled")]
  OrdersCancelled,

  [Description("payments.processed")]
  PaymentsProcessed
}

// Type-safe topic assignment
[TopicFilter<ServiceBusTopics>(ServiceBusTopics.OrdersCreated)]
public record CreateOrderCommand : ICommand {
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
}
```

**How it works**:
1. Generator extracts `[Description]` attribute value at compile time ("orders.created")
2. Falls back to enum symbol name if no `[Description]` ("OrdersCreated")
3. No reflection or runtime lookup - 100% AOT compatible

### Multiple Filters

Commands can have multiple topic filters for fan-out scenarios:

```csharp
// Publish to both primary and backup queues
[TopicFilter("orders.primary")]
[TopicFilter("orders.backup")]
public record CreateOrderCommand : ICommand {
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
}

// Publish to multiple event streams
[TopicFilter<ServiceBusTopics>(ServiceBusTopics.OrdersCreated)]
[TopicFilter<ServiceBusTopics>(ServiceBusTopics.Analytics)]
public record CreateOrderCommand : ICommand {
  // ...
}
```

## Generated Registry

The `TopicFilterGenerator` source generator creates an AOT-compatible registry:

```csharp
// Generated code (example)
namespace MyApp.Generated;

public static class TopicFilterRegistry {
  public static string[] GetTopicFilters<TCommand>() where TCommand : ICommand {
    if (typeof(TCommand) == typeof(global::MyApp.Commands.CreateOrderCommand)) {
      return new[] { "orders.created" };
    }
    if (typeof(TCommand) == typeof(global::MyApp.Commands.ProcessPaymentCommand)) {
      return new[] { "payments.processed" };
    }
    return Array.Empty<string>();
  }

  public static IReadOnlyDictionary<string, string[]> GetAllFilters() {
    return new Dictionary<string, string[]> {
      { "CreateOrderCommand", new[] { "orders.created" } },
      { "ProcessPaymentCommand", new[] { "payments.processed" } }
    };
  }
}
```

### Usage

Query topic filters at runtime for routing decisions:

```csharp
// Get filters for a specific command type
var filters = TopicFilterRegistry.GetTopicFilters<CreateOrderCommand>();
// Returns: ["orders.created"]

// Get all filters (for diagnostics/tooling)
var allFilters = TopicFilterRegistry.GetAllFilters();
// Returns: Dictionary<string, string[]> of all command → filter mappings
```

## Custom Derived Attributes

Create domain-specific attributes by inheriting from `TopicFilterAttribute`:

```csharp
using System.ComponentModel;
using Whizbang.Core;

// RabbitMQ-specific topics
public enum RabbitMqTopics {
  [Description("orders.exchange")]
  OrdersExchange,

  [Description("payments.exchange")]
  PaymentsExchange
}

// Custom attribute for RabbitMQ
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public class RabbitMqTopicAttribute : TopicFilterAttribute<RabbitMqTopics> {
  public RabbitMqTopicAttribute(RabbitMqTopics topic) : base(topic) { }
}

// Usage: Domain-specific attribute with same functionality
[RabbitMqTopic(RabbitMqTopics.OrdersExchange)]
public record CreateOrderCommand : ICommand {
  // ...
}
```

**Benefits**:
- Clear intent (attribute name indicates transport type)
- Centralized configuration per transport
- Type safety with transport-specific enums
- Generator automatically recognizes derived attributes

## Best Practices

### 1. Use Enums for Centralized Configuration

```csharp
// ✅ GOOD: Centralized, type-safe, refactor-friendly
public enum Topics {
  [Description("orders.created")]
  OrdersCreated,

  [Description("orders.cancelled")]
  OrdersCancelled
}

[TopicFilter<Topics>(Topics.OrdersCreated)]
public record CreateOrderCommand : ICommand { }

// ❌ BAD: Scattered string literals, typo-prone
[TopicFilter("orders.created")]  // What if you typo this?
public record CreateOrderCommand : ICommand { }

[TopicFilter("orders.creted")]   // Typo! Runtime failure
public record ProcessOrderCommand : ICommand { }
```

### 2. Use Description Attributes for Production Values

```csharp
// ✅ GOOD: Description defines actual topic name
public enum Topics {
  [Description("prod.orders.v2.created")]  // Production topic name
  OrdersCreated,  // Clean, readable symbol name
}

// ❌ BAD: Enum symbol must match topic (verbose, constrained)
public enum Topics {
  prod_orders_v2_created  // Forced to match topic syntax
}
```

### 3. Group Topics by Domain or Transport

```csharp
// ✅ GOOD: Organized by domain
public enum OrderTopics {
  [Description("orders.created")]
  Created,

  [Description("orders.updated")]
  Updated
}

public enum PaymentTopics {
  [Description("payments.processed")]
  Processed,

  [Description("payments.refunded")]
  Refunded
}

// ❌ BAD: Single flat enum for all topics
public enum AllTopics {
  OrdersCreated,
  OrdersUpdated,
  PaymentsProcessed,
  PaymentsRefunded,
  InventoryUpdated,
  // ... 100 more topics
}
```

### 4. Use Multiple Filters for Fan-Out

```csharp
// ✅ GOOD: Multiple filters for legitimate fan-out
[TopicFilter<Topics>(Topics.OrdersCreated)]
[TopicFilter<Topics>(Topics.AnalyticsStream)]
public record CreateOrderCommand : ICommand { }

// ❌ BAD: Multiple filters for unrelated concerns (code smell)
[TopicFilter("orders.created")]
[TopicFilter("payments.pending")]  // Should be separate command
[TopicFilter("inventory.reserve")]  // Should be separate command
public record CreateOrderCommand : ICommand { }
```

### 5. Validate Topics at Startup

```csharp
// ✅ GOOD: Validate all topics exist in your message broker
public static void ValidateTopics(IServiceProvider services) {
  var allFilters = TopicFilterRegistry.GetAllFilters();
  var transport = services.GetRequiredService<ITransport>();

  foreach (var (command, topics) in allFilters) {
    foreach (var topic in topics) {
      if (!transport.TopicExists(topic)) {
        throw new InvalidOperationException(
          $"Command '{command}' references non-existent topic '{topic}'"
        );
      }
    }
  }
}
```

## Integration with Transports

Topic filters integrate with Whizbang's transport abstraction:

```csharp
// Query filters when publishing commands
public async Task PublishCommandAsync<TCommand>(TCommand command)
    where TCommand : ICommand {

  var topics = TopicFilterRegistry.GetTopicFilters<TCommand>();

  if (topics.Length == 0) {
    throw new InvalidOperationException(
      $"Command '{typeof(TCommand).Name}' has no topic filters"
    );
  }

  foreach (var topic in topics) {
    var destination = new TransportDestination {
      Topic = topic,
      // ... other routing metadata
    };

    await _transport.PublishAsync(command, destination);
  }
}
```

See [Transports](../infrastructure/transports.md) for details on transport integration.

## Diagnostics

The `TopicFilterGenerator` reports diagnostics during compilation:

### WHIZ022: Topic Filter Discovered (Info)

```
Info WHIZ022: Found topic filter 'orders.created' on command 'CreateOrderCommand'
```

Generated for every discovered topic filter. Useful for verifying generation.

### WHIZ023: Enum Filter No Description (Info)

```
Info WHIZ023: Enum value 'Topics.OrdersCreated' has no [Description] attribute. Using enum symbol name 'OrdersCreated' as filter.
```

Warns when an enum value lacks a `[Description]` attribute. The symbol name is used as fallback.

### WHIZ025: TopicFilter On Non-Command (Warning)

```
Warning WHIZ025: [TopicFilter] on type 'MyClass' which does not implement ICommand. Filter will be ignored.
```

Indicates you've placed `[TopicFilter]` on a type that doesn't implement `ICommand`.

### WHIZ026: No Topic Filters Found (Info)

```
Info WHIZ026: No [TopicFilter] attributes were found in the compilation. TopicFilterRegistry will not be generated.
```

Reports when no topic filters are found in the assembly.

## Example: Multi-Transport Scenario

Using custom attributes for different transports:

```csharp
// Azure Service Bus topics
public enum ServiceBusTopics {
  [Description("prod-orders-v2")]
  Orders,

  [Description("prod-payments-v2")]
  Payments
}

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
public class ServiceBusTopicAttribute : TopicFilterAttribute<ServiceBusTopics> {
  public ServiceBusTopicAttribute(ServiceBusTopics topic) : base(topic) { }
}

// RabbitMQ exchanges
public enum RabbitMqExchanges {
  [Description("orders.exchange")]
  OrdersExchange,

  [Description("payments.exchange")]
  PaymentsExchange
}

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
public class RabbitMqExchangeAttribute : TopicFilterAttribute<RabbitMqExchanges> {
  public RabbitMqExchangeAttribute(RabbitMqExchanges exchange) : base(exchange) { }
}

// Command with both transport configurations
[ServiceBusTopic(ServiceBusTopics.Orders)]
[RabbitMqExchange(RabbitMqExchanges.OrdersExchange)]
public record CreateOrderCommand : ICommand {
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
}

// Runtime routing logic can query both
var allFilters = TopicFilterRegistry.GetTopicFilters<CreateOrderCommand>();
// Returns: ["prod-orders-v2", "orders.exchange"]
```

## Related Topics

- [Source Generators](../source-generators/topic-filter-discovery.md) - How TopicFilterGenerator works
- [Commands and Events](commands-events.md) - Core message types
- [Transports](../infrastructure/transports.md) - Message transport abstraction
- [Message Envelopes](message-envelopes.md) - Message routing and metadata

## Summary

- **Topic Filters** provide declarative, compile-time routing configuration for commands
- **String-based filters** for simple scenarios, **enum-based** for type safety and centralization
- **Multiple filters** supported via `AllowMultiple = true`
- **Custom attributes** for domain-specific or transport-specific configuration
- **Source generation** ensures zero-reflection, AOT-compatible code
- **GetTopicFilters()** queries filters at runtime for routing decisions
- **Diagnostics** (WHIZ022-WHIZ026) provide visibility during compilation
