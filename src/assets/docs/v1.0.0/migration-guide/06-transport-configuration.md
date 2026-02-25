---
title: Transport Configuration
version: 1.0.0
category: Migration Guide
order: 7
description: Configuring RabbitMQ and Azure Service Bus transports for Whizbang
tags: 'migration, transport, rabbitmq, azure-service-bus, messaging'
codeReferences:
  - src/Whizbang.Transports.RabbitMQ/ServiceCollectionExtensions.cs
  - src/Whizbang.Transports.AzureServiceBus/ServiceCollectionExtensions.cs
---

# Transport Configuration

This guide covers configuring message transports in Whizbang, including environment-based switching between RabbitMQ (local development) and Azure Service Bus (production).

## Transport Options

| Transport | Package | Use Case |
|-----------|---------|----------|
| RabbitMQ | `Whizbang.Transports.RabbitMQ` | Local development, Aspire |
| Azure Service Bus | `Whizbang.Transports.AzureServiceBus` | Production, Azure deployment |
| In-Memory | Built-in | Unit testing |

## Environment-Based Transport Switching

### Recommended Pattern: Runtime Configuration

```csharp
var builder = WebApplication.CreateBuilder(args);

// Core Whizbang setup
builder.Services.AddWhizbang(options => {
    options.UsePostgres(builder.Configuration.GetConnectionString("postgres")!);
});

// Transport switching based on configuration
var useRabbitMQ = builder.Configuration.GetValue<bool>("UseRabbitMQ");

if (useRabbitMQ) {
    // Local development with Aspire/RabbitMQ
    builder.Services.AddRabbitMQTransport(
        builder.Configuration.GetConnectionString("rabbitmq")!,
        options => {
            options.DefaultExchange = "whizbang.events";
            options.MaxChannels = 10;
            options.PrefetchCount = 16;
        });

    builder.Services.AddRabbitMQHealthChecks();
} else {
    // Production with Azure Service Bus
    builder.Services.AddAzureServiceBusTransport(
        builder.Configuration.GetConnectionString("servicebus")!,
        options => {
            options.DefaultTopicName = "whizbang-events";
            options.MaxConcurrentCalls = 16;
            options.AutoComplete = false;
        });

    builder.Services.AddAzureServiceBusHealthChecks();
}
```

### Configuration Files

**appsettings.Development.json**:

```json
{
  "UseRabbitMQ": true,
  "ConnectionStrings": {
    "postgres": "Host=localhost;Database=myapp;Username=postgres;Password=postgres",
    "rabbitmq": "amqp://guest:guest@localhost:5672"
  },
  "RabbitMQ": {
    "Exchange": "whizbang.events",
    "MaxChannels": 10,
    "PrefetchCount": 16
  }
}
```

**appsettings.Production.json**:

```json
{
  "UseRabbitMQ": false,
  "ConnectionStrings": {
    "postgres": "Host=myapp.postgres.database.azure.com;Database=myapp;...",
    "servicebus": "Endpoint=sb://myapp.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=..."
  },
  "AzureServiceBus": {
    "TopicName": "whizbang-events",
    "MaxConcurrentCalls": 16
  }
}
```

## RabbitMQ Configuration

### Basic Setup

```csharp
builder.Services.AddRabbitMQTransport(
    builder.Configuration.GetConnectionString("rabbitmq")!);
```

### Advanced Configuration

```csharp
builder.Services.AddRabbitMQTransport(
    builder.Configuration.GetConnectionString("rabbitmq")!,
    options => {
        // Exchange configuration
        options.DefaultExchange = "whizbang.events";
        options.ExchangeType = ExchangeType.Topic;
        options.Durable = true;

        // Connection pooling
        options.MaxChannels = 10;

        // Consumer configuration
        options.PrefetchCount = 16;
        options.AutoAck = false;

        // Retry configuration
        options.RetryPolicy = RetryPolicy.Exponential(
            maxRetries: 5,
            initialDelay: TimeSpan.FromSeconds(1),
            maxDelay: TimeSpan.FromMinutes(1)
        );

        // Dead letter queue
        options.DeadLetterExchange = "whizbang.dlx";
    });

// Add health checks
builder.Services.AddHealthChecks()
    .AddRabbitMQ(name: "rabbitmq");
```

### Aspire Integration

```csharp
// In AppHost project
var rabbitmq = builder.AddRabbitMQ("rabbitmq")
    .WithManagementPlugin();

var api = builder.AddProject<Projects.MyApp_API>("api")
    .WithReference(rabbitmq);
```

```csharp
// In API project
builder.AddRabbitMQClient("rabbitmq");
builder.Services.AddRabbitMQTransport(options => {
    // Connection string resolved via Aspire
});
```

## Azure Service Bus Configuration

### Basic Setup

```csharp
builder.Services.AddAzureServiceBusTransport(
    builder.Configuration.GetConnectionString("servicebus")!);
```

### Advanced Configuration

```csharp
builder.Services.AddAzureServiceBusTransport(
    builder.Configuration.GetConnectionString("servicebus")!,
    options => {
        // Topic configuration
        options.DefaultTopicName = "whizbang-events";

        // Subscription configuration
        options.SubscriptionName = "order-service";
        options.MaxConcurrentCalls = 16;
        options.AutoComplete = false;

        // Session handling (for ordered processing)
        options.RequiresSession = false;

        // Retry configuration
        options.MaxDeliveryCount = 10;
        options.RetryOptions = new ServiceBusRetryOptions {
            MaxRetries = 5,
            Delay = TimeSpan.FromSeconds(1),
            MaxDelay = TimeSpan.FromMinutes(1),
            Mode = ServiceBusRetryMode.Exponential
        };

        // Dead letter configuration
        options.DeadLetterOnMessageExpiration = true;
    });

// Add health checks
builder.Services.AddHealthChecks()
    .AddAzureServiceBusTopic(
        builder.Configuration.GetConnectionString("servicebus")!,
        "whizbang-events",
        name: "servicebus");
```

### Managed Identity Authentication

```csharp
builder.Services.AddAzureServiceBusTransport(options => {
    options.FullyQualifiedNamespace = "myapp.servicebus.windows.net";
    options.Credential = new DefaultAzureCredential();
    options.DefaultTopicName = "whizbang-events";
});
```

## Migrating from Wolverine Transports

### Wolverine RabbitMQ

```csharp
// Wolverine
builder.Host.UseWolverine(opts => {
    opts.UseRabbitMq("amqp://guest:guest@localhost:5672")
        .UseConventionalRouting()
        .UseDurableOutbox();
});
```

```csharp
// Whizbang
builder.Services.AddRabbitMQTransport(
    "amqp://guest:guest@localhost:5672",
    options => {
        // Outbox is built-in to Whizbang Core
        options.DefaultExchange = "whizbang.events";
    });
```

### Wolverine Azure Service Bus

```csharp
// Wolverine
builder.Host.UseWolverine(opts => {
    opts.UseAzureServiceBus(connectionString)
        .UseTopicsAndSubscriptions()
        .UseDurableOutbox();
});
```

```csharp
// Whizbang
builder.Services.AddAzureServiceBusTransport(
    connectionString,
    options => {
        options.DefaultTopicName = "whizbang-events";
    });
```

## Message Routing

### Topic-Based Routing

```csharp
builder.Services.AddWhizbang(options => {
    options.ConfigureRouting(routing => {
        // Route by message type
        routing.Route<OrderCreated>().ToTopic("orders");
        routing.Route<PaymentProcessed>().ToTopic("payments");

        // Route by convention
        routing.RouteByConvention(msg => msg.GetType().Namespace!.Split('.').Last());
    });
});
```

### Subscription Configuration

```csharp
builder.Services.AddWhizbang(options => {
    options.ConfigureSubscriptions(subs => {
        // Subscribe to specific topics
        subs.Subscribe<OrderCreated>("orders");
        subs.Subscribe<PaymentProcessed>("payments");

        // Subscribe with filter
        subs.Subscribe<OrderCreated>("orders")
            .WithFilter("Total > 1000");
    });
});
```

## Testing Configuration

### In-Memory Transport for Tests

```csharp
public class TestFixture {
    public ServiceProvider BuildTestServices() {
        var services = new ServiceCollection();

        services.AddWhizbang(options => {
            options.UseInMemoryEventStore();
        });

        // Use in-memory transport for testing
        services.AddInMemoryTransport();

        return services.BuildServiceProvider();
    }
}
```

### Integration Test with TestContainers

```csharp
public class IntegrationTestFixture : IAsyncLifetime {
    private RabbitMqContainer _rabbitMq = null!;

    public async Task InitializeAsync() {
        _rabbitMq = new RabbitMqBuilder()
            .WithImage("rabbitmq:3-management")
            .Build();

        await _rabbitMq.StartAsync();
    }

    public ServiceProvider BuildServices() {
        var services = new ServiceCollection();

        services.AddRabbitMQTransport(_rabbitMq.GetConnectionString());

        return services.BuildServiceProvider();
    }

    public async Task DisposeAsync() {
        await _rabbitMq.DisposeAsync();
    }
}
```

## Migration Checklist

- [ ] Add `Whizbang.Transports.RabbitMQ` and/or `Whizbang.Transports.AzureServiceBus` packages
- [ ] Configure environment-based transport switching
- [ ] Set up `appsettings.Development.json` for RabbitMQ
- [ ] Set up `appsettings.Production.json` for Azure Service Bus
- [ ] Configure health checks for transport
- [ ] Update Aspire integration (if using)
- [ ] Configure message routing
- [ ] Update integration tests to use in-memory transport

---

*Previous: [Event Store Migration](05-event-store-migration.md) | Next: [Outbox Migration](07-outbox-migration.md)*
