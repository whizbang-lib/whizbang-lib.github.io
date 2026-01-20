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
