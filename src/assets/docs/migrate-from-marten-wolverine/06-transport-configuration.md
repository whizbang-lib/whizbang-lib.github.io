# Migrate from Marten/Wolverine: Transport Configuration

This guide covers configuring message transports when migrating from Wolverine to Whizbang.

## Overview

| Wolverine | Whizbang |
|-----------|----------|
| `UseRabbitMq()` | `AddRabbitMQTransport()` |
| `UseAzureServiceBus()` | `AddAzureServiceBusTransport()` |
| `ListenToRabbitQueue()` | `AddSubscription()` |
| `PublishToRabbitExchange()` | `AddPublication()` |

## Basic Configuration

### RabbitMQ

#### Before: Wolverine

```csharp
builder.Host.UseWolverine(opts => {
    opts.UseRabbitMq(rabbit => {
        rabbit.HostName = "localhost";
    })
    .AutoProvision();

    opts.ListenToRabbitQueue("orders");
    opts.PublishAllMessages().ToRabbitExchange("events");
});
```

#### After: Whizbang

```csharp
builder.Services.AddWhizbang(options => {
    options.AddRabbitMQTransport(rabbit => {
        rabbit.ConnectionString = "amqp://guest:guest@localhost:5672";
        rabbit.AutoCreateTopology = true;
    });

    rabbit.AddSubscription<OrderCreated>("orders");
    rabbit.AddPublication<OrderCreated>("events");
});
```

### Azure Service Bus

#### Before: Wolverine

```csharp
builder.Host.UseWolverine(opts => {
    opts.UseAzureServiceBus(connectionString)
        .AutoProvision();

    opts.ListenToAzureServiceBusQueue("orders");
    opts.PublishAllMessages().ToAzureServiceBusTopic("events");
});
```

#### After: Whizbang

```csharp
builder.Services.AddWhizbang(options => {
    options.AddAzureServiceBusTransport(asb => {
        asb.ConnectionString = connectionString;
        asb.AutoCreateTopology = true;
    });

    asb.AddSubscription<OrderCreated>("orders");
    asb.AddPublication<OrderCreated>("events", topicName: "events");
});
```

## Runtime Transport Switching

For environments using RabbitMQ locally and Azure Service Bus in production:

```csharp
var useRabbitMQ = builder.Configuration.GetValue<bool>("UseRabbitMQ");

builder.Services.AddWhizbang(options => {
    if (useRabbitMQ) {
        options.AddRabbitMQTransport(rabbit => {
            rabbit.ConnectionString = builder.Configuration
                .GetConnectionString("RabbitMQ")!;
        });
    }
    else {
        options.AddAzureServiceBusTransport(asb => {
            asb.ConnectionString = builder.Configuration
                .GetConnectionString("ServiceBus")!;
        });
    }
});
```

### Configuration-Based Approach

```json
// appsettings.Development.json
{
  "Transport": {
    "Type": "RabbitMQ",
    "ConnectionString": "amqp://guest:guest@localhost:5672"
  }
}

// appsettings.Production.json
{
  "Transport": {
    "Type": "AzureServiceBus",
    "ConnectionString": "Endpoint=sb://..."
  }
}
```

```csharp
var transportType = builder.Configuration["Transport:Type"];
var connectionString = builder.Configuration["Transport:ConnectionString"];

builder.Services.AddWhizbang(options => {
    switch (transportType) {
        case "RabbitMQ":
            options.AddRabbitMQTransport(r => r.ConnectionString = connectionString);
            break;
        case "AzureServiceBus":
            options.AddAzureServiceBusTransport(a => a.ConnectionString = connectionString);
            break;
        default:
            options.AddInMemoryTransport(); // For testing
            break;
    }
});
```

## Domain Ownership

In microservice architectures, services **own** specific domains. Commands to owned domains route to that service's inbox, while events are published to domain-specific topics for any interested subscriber.

### Declaring Domain Ownership

```csharp
builder.Services.AddWhizbang(options => {
    // Declare which domains this service owns
    options.Routing.OwnDomains("orders", "inventory");
});
```

Domain ownership affects:
- **Inbound commands**: Commands targeting owned domains route to this service
- **Outbound events**: Events are published to domain-specific topics

### Configuration-Based Ownership

```json
// appsettings.json
{
  "Whizbang": {
    "Routing": {
      "OwnedDomains": ["orders", "inventory"]
    }
  }
}
```

```csharp
builder.Services.AddWhizbang(options => {
    var domains = builder.Configuration
        .GetSection("Whizbang:Routing:OwnedDomains")
        .Get<string[]>() ?? [];
    options.Routing.OwnDomains(domains);
});
```

## Inbox & Outbox Routing Strategies

Whizbang separates **inbox** (receiving commands) and **outbox** (publishing events) routing strategies.

### Inbox Strategies

The inbox strategy determines how this service receives commands.

#### SharedTopicInboxStrategy (Default)

All commands route to a single shared topic with broker-side filtering:

```csharp
builder.Services.AddWhizbang(options => {
    options.Routing.OwnDomains("orders", "inventory");
    options.Routing.Inbox.UseSharedTopic(); // Default: "whizbang.inbox"
    // Or with custom topic:
    options.Routing.Inbox.UseSharedTopic("commands.inbox");
});
```

**How it works**:
- All services publish commands to `whizbang.inbox`
- Commands include a `Destination` property (domain name)
- Broker filters messages: only commands where `Destination` matches owned domains are delivered
- **Pros**: Fewer topics, centralized command routing
- **Cons**: Requires broker-side filtering (ASB CorrelationFilter, RabbitMQ routing keys)

#### DomainTopicInboxStrategy

Each domain has its own inbox topic:

```csharp
builder.Services.AddWhizbang(options => {
    options.Routing.OwnDomains("orders", "inventory");
    options.Routing.Inbox.UseDomainTopics(); // Default suffix: ".inbox"
    // Or with custom suffix:
    options.Routing.Inbox.UseDomainTopics(".in");
});
```

**How it works**:
- Commands to `orders` domain → `orders.inbox` topic
- Commands to `inventory` domain → `inventory.inbox` topic
- Service subscribes to all owned domain inboxes
- **Pros**: Simple routing, no broker-side filtering needed
- **Cons**: More topics to manage

### Outbox Strategies

The outbox strategy determines how this service publishes events.

#### DomainTopicOutboxStrategy (Default)

Each domain publishes to its own topic:

```csharp
builder.Services.AddWhizbang(options => {
    options.Routing.OwnDomains("orders");
    options.Routing.Outbox.UseDomainTopics(); // Default
});
```

**How it works**:
- `OrderCreated` event → published to `orders` topic
- Domain extracted from namespace or type name
- **Pros**: Clear domain separation, easy subscription filtering
- **Cons**: Subscribers must know which domains they need

#### SharedTopicOutboxStrategy

All events publish to a single shared topic:

```csharp
builder.Services.AddWhizbang(options => {
    options.Routing.Outbox.UseSharedTopic(); // Default: "whizbang.events"
    // Or with custom topic:
    options.Routing.Outbox.UseSharedTopic("all.events");
});
```

**How it works**:
- All events → `whizbang.events` topic
- Domain included in message metadata
- **Pros**: Single topic for all events, simpler topology
- **Cons**: Requires metadata-based filtering for subscribers

### Combined Configuration

```csharp
builder.Services.AddWhizbang(options => {
    options.Routing
        .OwnDomains("orders", "inventory")
        .ConfigureInbox(inbox => inbox.UseSharedTopic())    // Recommended default
        .ConfigureOutbox(outbox => outbox.UseDomainTopics()); // Recommended default
});
```

### Custom Routing Strategies

Implement custom strategies for specialized routing:

```csharp
public class TenantAwareInboxStrategy : IInboxRoutingStrategy {
    public InboxSubscription GetSubscription(
        IReadOnlySet<string> ownedDomains,
        string serviceName,
        MessageKind kind) {
        // Custom logic: e.g., tenant-specific inbox
        return new InboxSubscription(
            Topic: $"{serviceName}.inbox",
            FilterExpression: string.Join(",", ownedDomains)
        );
    }
}

builder.Services.AddWhizbang(options => {
    options.Routing.Inbox.UseCustom(new TenantAwareInboxStrategy());
});
```

## Message Routing

### Queue/Topic Configuration

```csharp
builder.Services.AddWhizbang(options => {
    options.ConfigureTransport(transport => {
        // Subscribe to specific message types
        transport.AddSubscription<CreateOrderCommand>("commands.orders");
        transport.AddSubscription<OrderCreated>("events.orders");

        // Publish specific message types
        transport.AddPublication<OrderCreated>("events");
        transport.AddPublication<OrderShipped>("events");

        // Publish all messages of a base type
        transport.AddPublication<IEvent>("events");
    });
});
```

### Topic Routing Strategies

Whizbang provides flexible topic routing strategies for dynamic message routing.

#### NamespaceRoutingStrategy

Routes messages to topics based on namespace patterns. Useful for projects with either hierarchical or flat namespace structures.

```csharp
// Default behavior:
// - MyApp.Orders.Events.OrderCreated → "orders"
// - MyApp.Contracts.Commands.CreateOrder → "order"
builder.Services.AddWhizbang(options => {
    options.TopicRouting.UseNamespaceRouting();
});

// Custom extraction logic
builder.Services.AddWhizbang(options => {
    options.TopicRouting.UseNamespaceRouting(type => {
        // Use [Topic] attribute if present, else default
        var attr = type.GetCustomAttribute<TopicAttribute>();
        return attr?.Name ?? NamespaceRoutingStrategy.DefaultTypeToTopic(type);
    });
});
```

**How it works:**

| Namespace/Type | Extracted Topic |
|----------------|-----------------|
| `MyApp.Orders.Events.OrderCreated` | `orders` |
| `MyApp.Contracts.Commands.CreateOrder` | `order` |
| `MyApp.Contracts.Events.OrderCreated` | `order` |
| `MyApp.Contracts.Queries.GetOrderById` | `order` |

The strategy:
1. Uses the second-to-last namespace segment for hierarchical namespaces
2. Skips generic segments (`contracts`, `commands`, `events`, `queries`, `messages`)
3. Falls back to extracting domain from type name (removes prefixes/suffixes)

#### CompositeTopicRoutingStrategy

Chain multiple strategies together:

```csharp
var composite = new CompositeTopicRoutingStrategy(
    new NamespaceRoutingStrategy(),
    new PoolSuffixRoutingStrategy("01")
);

// orders → orders-01
```

### Consumer Groups

```csharp
builder.Services.AddWhizbang(options => {
    options.ConfigureTransport(transport => {
        // Competing consumers (only one instance handles each message)
        transport.AddSubscription<OrderCreated>("orders", options => {
            options.ConsumerGroup = "order-processor";
            options.ConcurrentConsumers = 5;
        });

        // Broadcast (all instances receive each message)
        transport.AddSubscription<CacheInvalidated>("cache", options => {
            options.Broadcast = true;
        });
    });
});
```

## Dead Letter Handling

### Configuration

```csharp
builder.Services.AddWhizbang(options => {
    options.ConfigureTransport(transport => {
        transport.AddSubscription<OrderCreated>("orders", options => {
            options.MaxRetries = 3;
            options.RetryDelay = TimeSpan.FromSeconds(5);
            options.DeadLetterQueue = "orders-dlq";
        });
    });
});
```

### Dead Letter Processing

```csharp
public class DeadLetterReceptor : IReceptor<DeadLetterMessage, Unit> {
  private readonly ILogger<DeadLetterReceptor> _logger;

  public DeadLetterReceptor(ILogger<DeadLetterReceptor> logger) {
    _logger = logger;
  }

  public ValueTask<Unit> HandleAsync(DeadLetterMessage message, CancellationToken ct) {
    _logger.LogError(
        "Dead letter received: {MessageType}, Reason: {Reason}",
        message.OriginalType,
        message.FailureReason);

    // Handle dead letter (alert, store for manual review, etc.)
    return ValueTask.FromResult(Unit.Value);
  }
}
```

## Serialization

### JSON Serialization (Default)

```csharp
builder.Services.AddWhizbang(options => {
    options.ConfigureTransport(transport => {
        transport.UseJsonSerialization(json => {
            json.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            json.WriteIndented = false;
        });
    });
});
```

### Custom Serialization

```csharp
builder.Services.AddWhizbang(options => {
    options.ConfigureTransport(transport => {
        transport.UseSerializer<MyCustomSerializer>();
    });
});
```

## Aspire Integration

For .NET Aspire-based applications:

```csharp
// In AppHost
var rabbitmq = builder.AddRabbitMQ("messaging");
var serviceBus = builder.AddAzureServiceBus("messaging");

var orderService = builder.AddProject<Projects.OrderService>()
    .WithReference(rabbitmq); // or serviceBus

// In OrderService
builder.AddWhizbangWithAspire(); // Auto-configures from Aspire connection
```

## Migration Strategy

### Parallel Running

Run both Wolverine and Whizbang simultaneously:

```csharp
// Keep Wolverine temporarily
builder.Host.UseWolverine(opts => {
    opts.UseRabbitMq().AutoProvision();
    opts.ListenToRabbitQueue("orders-wolverine");
});

// Add Whizbang on different queues
builder.Services.AddWhizbang(options => {
    options.AddRabbitMQTransport(r => r.ConnectionString = connectionString);
    options.ConfigureTransport(t => {
        t.AddSubscription<OrderCreated>("orders-whizbang");
    });
});
```

### Gradual Queue Migration

1. Create new queues with `-v2` suffix
2. Configure Whizbang to consume from new queues
3. Update publishers to send to both old and new queues
4. Monitor and validate
5. Switch consumers to new queues only
6. Remove old queue configuration

## Checklist

- [ ] Identify all Wolverine transport configurations
- [ ] Map queue/topic names between frameworks
- [ ] Configure Whizbang transport (RabbitMQ or Azure Service Bus)
- [ ] Set up message routing (subscriptions and publications)
- [ ] Configure dead letter handling
- [ ] Test with in-memory transport first
- [ ] Plan parallel running strategy
- [ ] Update connection strings in configuration
- [ ] Verify message serialization compatibility

## Next Steps

- [Outbox Migration](./07-outbox-migration.md) - Migrate durable outbox patterns
