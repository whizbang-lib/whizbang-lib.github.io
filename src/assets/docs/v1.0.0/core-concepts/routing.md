# Namespace-Based Routing

Whizbang uses namespace-based routing to determine where messages flow. Commands and events follow distinct routing patterns optimized for their specific use cases.

## Overview

Routing in Whizbang is built on two key principles:

1. **Commands → Shared Inbox**: All commands route to a single shared "inbox" topic. Services filter by owned namespaces using routing key patterns.
2. **Events → Namespace Topics**: Events publish to namespace-specific topics. Services subscribe directly to namespaces they care about.

This separation provides:
- **Point-to-point delivery** for commands (exactly one handler)
- **Pub/sub distribution** for events (multiple subscribers)
- **Automatic subscription discovery** via source generation

## Command Flow

Commands follow a point-to-point pattern with namespace-based filtering:

```
BFF sends CreateTenantCommand (namespace: MyApp.Users.Commands)
    ↓
BFF Outbox → Broker "inbox" topic
    ↓
    RoutingKey: "myapp.users.commands.createtenantcommand"
    ↓
ALL services subscribed to "inbox" (single shared topic)
    ↓
Each service filters by owned namespaces:
    - User Service owns "myapp.users.commands" → RECEIVES
    - Workflow Service owns "myapp.workflow.commands" → FILTERED OUT
    ↓
User Service processes command
```

### How Command Filtering Works

When a service starts, it declares which command namespaces it owns:

```csharp
services.Configure<RoutingOptions>(opts => {
  opts.OwnDomains("myapp.users.commands");
  opts.OwnDomains("myapp.inventory.commands");
});
```

The `SharedTopicInboxStrategy` builds routing patterns from these namespaces:

```csharp
// Generated routing patterns:
// - "whizbang.core.commands.system.#"  (always included)
// - "myapp.users.commands.#"
// - "myapp.inventory.commands.#"
```

**Note**: All services automatically subscribe to system commands (`whizbang.core.commands.system.#`) for framework-level operations.

### Wildcard Namespaces

Support pattern matching for flexible ownership:

```csharp
// Own all commands under myapp.orders
opts.OwnDomains("myapp.orders.*");
// Converts to pattern: "myapp.orders.#"
```

## Event Flow

Events follow a pub/sub pattern with namespace-based topics:

```
User Service publishes TenantCreatedEvent (namespace: MyApp.Users.Events)
    ↓
User Service Outbox → Broker topic "myapp.users.events"
    ↓
    RoutingKey: "tenantcreatedevent"
    ↓
Services subscribed to "myapp.users.events":
    - BFF → RECEIVES
    - Workflow Service → RECEIVES
    - Notifications Service → RECEIVES
```

### Automatic Event Subscription Discovery

Event subscriptions are **automatically discovered** from your code via source generation:

1. **Perspectives**: Events your service projects
2. **Receptors**: Events your service handles

```csharp
// This perspective automatically subscribes to "myapp.orders.events"
[Perspective<OrderSummary>]
public class OrderSummaryPerspective : IPerspective<OrderCreatedEvent> {
  // OrderCreatedEvent is in namespace MyApp.Orders.Events
}

// This receptor automatically subscribes to "myapp.payments.events"
public class PaymentReceptor : IReceptor<PaymentCompletedEvent> {
  // PaymentCompletedEvent is in namespace MyApp.Payments.Events
}
```

The `EventNamespaceRegistryGenerator` source generator extracts these namespaces at compile time:

```csharp
// Generated code (example)
public sealed class GeneratedEventNamespaceRegistry : IEventNamespaceRegistry {
  public IReadOnlySet<string> GetPerspectiveEventNamespaces() =>
    new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
      "myapp.orders.events"
    };

  public IReadOnlySet<string> GetReceptorEventNamespaces() =>
    new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
      "myapp.payments.events"
    };
}
```

### Manual Event Subscriptions

Override or supplement auto-discovery with manual subscriptions:

```csharp
services.Configure<RoutingOptions>(opts => {
  // Explicitly subscribe to additional event namespaces
  opts.SubscribeTo("myapp.notifications.events");
  opts.SubscribeTo("myapp.audit.events");
});
```

## System Commands

All services automatically subscribe to system commands for framework-level operations:

```csharp
namespace Whizbang.Core.Commands.System;

// Rebuild a perspective across all services
public record RebuildPerspectiveCommand(
    string PerspectiveName,
    long? FromEventId = null
) : ICommand;

// Clear cached data
public record ClearCacheCommand(
    string? CacheKey = null,
    string? CacheRegion = null
) : ICommand;

// Collect diagnostics from all services
public record DiagnosticsCommand(
    DiagnosticType Type,
    Guid? CorrelationId = null
) : ICommand;

// Pause message processing (coordinated maintenance)
public record PauseProcessingCommand(
    int? DurationSeconds = null,
    string? Reason = null
) : ICommand;

// Resume message processing
public record ResumeProcessingCommand(
    string? Reason = null
) : ICommand;
```

### Sending System Commands

```csharp
// Rebuild a perspective across all services
await dispatcher.SendAsync(new RebuildPerspectiveCommand("OrderSummary"));

// Clear all caches
await dispatcher.SendAsync(new ClearCacheCommand());

// Pause processing for 5 minutes
await dispatcher.SendAsync(new PauseProcessingCommand(
    DurationSeconds: 300,
    Reason: "Scheduled maintenance"
));
```

## Configuration

### Complete Example

```csharp
// User Service - handles user commands, subscribes to order events
services.Configure<RoutingOptions>(opts => {
  // Commands this service handles
  opts.OwnDomains("myapp.users.commands");

  // Events are auto-discovered from perspectives/receptors
  // Manual override (adds to auto-discovered):
  opts.SubscribeTo("myapp.notifications.events");
});

// BFF Service - sends commands, receives events
services.Configure<RoutingOptions>(opts => {
  // No OwnDomains (BFF doesn't handle commands directly)

  // Events auto-discovered from its receptors/perspectives
});
```

### Inbox Strategies

Two inbox routing strategies are available:

#### SharedTopicInboxStrategy (Default)

All commands go to a single "inbox" topic with namespace-based filtering:

```csharp
services.Configure<RoutingOptions>(opts => {
  opts.Inbox.UseSharedTopic("inbox");  // Default
});
```

#### DomainTopicInboxStrategy

Each domain gets its own inbox topic:

```csharp
services.Configure<RoutingOptions>(opts => {
  opts.Inbox.UseDomainTopics(".in");
  // Creates topics: "myapp.users.in", "myapp.orders.in", etc.
});
```

## Transport Subscription Builder

The `TransportSubscriptionBuilder` combines inbox and event subscriptions for transport configuration:

```csharp
// Build all destinations for transport subscription
var builder = new TransportSubscriptionBuilder(
    routingOptions,
    eventSubscriptionDiscovery,
    serviceName: "OrderService"
);

var destinations = builder.BuildDestinations();
// Returns:
// - Inbox destination with command filtering
// - Event namespace destinations (auto + manual)

// Configure transport options
builder.ConfigureOptions(transportOptions);
```

### Destination Structure

Each destination contains:

```csharp
public record TransportDestination(
    string Address,        // Topic/queue name
    string? RoutingKey,    // Routing key pattern (e.g., "#" for all)
    IReadOnlyDictionary<string, JsonElement>? Metadata
);
```

## Broker Integration

### RabbitMQ

- **Commands**: Single "inbox" exchange with routing key pattern matching
- **Events**: One exchange per namespace with topic routing

```
Exchange: inbox
  Binding: myapp.users.commands.# → queue: user-service-inbox
  Binding: myapp.inventory.commands.# → queue: inventory-service-inbox

Exchange: myapp.orders.events
  Binding: # → queue: user-service-orders
  Binding: # → queue: bff-orders
```

### Azure Service Bus

- **Commands**: Single "inbox" topic with CorrelationFilter on routing key
- **Events**: One topic per namespace with subscriptions

```
Topic: inbox
  Subscription: user-service (filter: RoutingKey LIKE 'myapp.users.commands.%')
  Subscription: inventory-service (filter: RoutingKey LIKE 'myapp.inventory.commands.%')

Topic: myapp.orders.events
  Subscription: user-service
  Subscription: bff
```

## Best Practices

### 1. Use Consistent Namespace Conventions

```csharp
// ✅ GOOD: Clear, hierarchical namespaces
namespace MyApp.Users.Commands;
namespace MyApp.Users.Events;
namespace MyApp.Orders.Commands;
namespace MyApp.Orders.Events;

// ❌ BAD: Flat or inconsistent namespaces
namespace MyAppCommands;
namespace OrderEvents;
```

### 2. Let Auto-Discovery Do the Work

```csharp
// ✅ GOOD: Events discovered automatically
[Perspective<OrderSummary>]
public class OrderSummaryPerspective : IPerspective<OrderCreatedEvent> {
  // Auto-subscribes to "myapp.orders.events"
}

// ❌ BAD: Manually subscribing to everything
opts.SubscribeTo("myapp.orders.events");
opts.SubscribeTo("myapp.payments.events");
opts.SubscribeTo("myapp.users.events");
// ... 20 more manual subscriptions
```

### 3. Use Manual Subscriptions for Cross-Cutting Concerns

```csharp
// ✅ GOOD: Manual subscription for audit/logging service
services.Configure<RoutingOptions>(opts => {
  opts.SubscribeTo("myapp.*.events");  // All events for auditing
});
```

### 4. Validate Subscriptions at Startup

```csharp
// Ensure all expected namespaces are subscribed
var discovery = services.GetRequiredService<EventSubscriptionDiscovery>();
var namespaces = discovery.DiscoverAll();

logger.LogInformation(
    "Subscribed to {Count} event namespaces: {Namespaces}",
    namespaces.Count,
    string.Join(", ", namespaces)
);
```

## Related Documentation

- [System Events](./system-events.md) - System-level event auditing
- [Security](./security.md) - Permissions and access control
- [Scoping](./scoping.md) - Multi-tenancy and data isolation
