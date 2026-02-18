# Transport Consumer

The transport consumer automatically subscribes to message broker destinations and processes incoming messages. When combined with `WithRouting()`, subscriptions are auto-generated from your routing configuration.

## Overview

The `AddTransportConsumer()` extension method:

1. **Auto-generates subscriptions** from `RoutingOptions` configured via `WithRouting()`
2. **Registers `TransportConsumerOptions`** with populated destinations
3. **Starts `TransportConsumerWorker`** as a hosted service

## Auto-Configuration {#auto-configuration}

The recommended approach chains `WithRouting()` and `AddTransportConsumer()`:

```csharp
services.AddWhizbang()
    .WithRouting(routing => {
        routing
            .OwnDomains("myapp.orders.commands")
            .SubscribeTo("myapp.payments.events")
            .Inbox.UseSharedTopic("inbox");
    })
    .WithEFCore<OrderDbContext>()
    .WithDriver.Postgres
    .AddTransportConsumer();
```

This auto-generates subscriptions:
- **Inbox subscription** from `OwnDomains()` - Filters commands by namespace pattern
- **Event subscriptions** from `SubscribeTo()` - Subscribes to each namespace topic
- **Auto-discovered events** from perspectives and receptors

### What Gets Generated

For the configuration above, `AddTransportConsumer()` generates:

| Destination | Address | Routing Key |
|-------------|---------|-------------|
| Inbox | `inbox` | `myapp.orders.commands.#` |
| Payment Events | `myapp.payments.events` | `#` |

If your service has perspectives or receptors that handle events from other namespaces, those are automatically discovered and added.

## Additional Destinations {#additional-destinations}

Add custom destinations beyond auto-generated ones:

```csharp
services.AddWhizbang()
    .WithRouting(routing => {
        routing.OwnDomains("myapp.orders.commands");
    })
    .AddTransportConsumer(config => {
        // Add custom destination
        config.AdditionalDestinations.Add(
            new TransportDestination("custom-topic", "my-subscription"));

        // Add multiple custom destinations
        config.AdditionalDestinations.Add(
            new TransportDestination("audit-events", "#"));
    });
```

Additional destinations are appended after auto-generated ones.

## Complete Worker Setup

A typical worker service includes transport registration, routing, and consumer:

```csharp
var builder = Host.CreateApplicationBuilder(args);

// 1. Register transport (Azure Service Bus or RabbitMQ)
var serviceBusConnection = builder.Configuration.GetConnectionString("servicebus")
    ?? throw new InvalidOperationException("Connection string not found");
builder.Services.AddAzureServiceBusTransport(serviceBusConnection);

// 2. Configure Whizbang with routing and consumer
builder.Services.AddWhizbang()
    .WithRouting(routing => {
        routing
            .OwnDomains("myapp.orders.commands")
            .SubscribeTo("myapp.payments.events", "myapp.users.events")
            .Inbox.UseSharedTopic("inbox");
    })
    .WithEFCore<OrderDbContext>()
    .WithDriver.Postgres
    .AddTransportConsumer();

// 3. Register generated services
builder.Services.AddReceptors();
builder.Services.AddWhizbangDispatcher();

var host = builder.Build();
host.Run();
```

## Transport Independence

The consumer configuration is transport-agnostic. The same `WithRouting()` and `AddTransportConsumer()` calls work with:

- **Azure Service Bus** - Creates topics and subscriptions
- **RabbitMQ** - Creates exchanges and queues
- **In-Memory** (testing) - Direct message routing

Transport-specific behavior is handled by the transport implementation registered separately.

## Error Handling

When `WithRouting()` is not called before `AddTransportConsumer()`:

```csharp
// This throws InvalidOperationException at runtime
services.AddWhizbang()
    .AddTransportConsumer();  // Error: WithRouting() must be called first
```

The error occurs when resolving `TransportConsumerOptions` from the service provider, not at registration time.

## Subscription Resilience {#subscription-resilience}

:::new
Added in v1.0.0
:::

By default, the transport consumer includes built-in resilience for subscription failures. Subscriptions retry **forever** until success or cancellation - critical for production systems where transient broker issues should not cause permanent failures.

### Retry Behavior

The retry system uses **exponential backoff**:

| Property | Default | Description |
|----------|---------|-------------|
| `InitialRetryDelay` | 1 second | Starting delay between retries |
| `MaxRetryDelay` | 120 seconds | Cap on exponential backoff |
| `BackoffMultiplier` | 2.0 | Delay multiplier per attempt |
| `InitialRetryAttempts` | 5 | Attempts before reducing log verbosity |
| `RetryIndefinitely` | true | Never give up (recommended) |

### Configuration

Customize resilience behavior through `TransportConsumerConfiguration`:

```csharp
services.AddWhizbang()
    .WithRouting(routing => {
        routing.OwnDomains("myapp.orders.commands");
    })
    .AddTransportConsumer(config => {
        // Customize retry behavior
        config.ResilienceOptions.InitialRetryDelay = TimeSpan.FromSeconds(2);
        config.ResilienceOptions.MaxRetryDelay = TimeSpan.FromMinutes(5);
        config.ResilienceOptions.BackoffMultiplier = 1.5;

        // Allow partial failures (some subscriptions can fail)
        config.ResilienceOptions.AllowPartialSubscriptions = true;
    });
```

### Disabling Resilience

For testing or simple scenarios, resilience can be disabled:

```csharp
services.AddWhizbang()
    .WithRouting(routing => {
        routing.OwnDomains("myapp.orders.commands");
    })
    .AddTransportConsumer(config => {
        config.EnableResilience = false;  // Uses non-resilient worker
    });
```

### Health Monitoring

When resilience is enabled, a health check is automatically registered:

```csharp
app.MapHealthChecks("/health");  // Includes subscription health
```

Health check results:
- **Healthy**: All subscriptions active
- **Degraded**: Some subscriptions recovering or pending
- **Unhealthy**: All subscriptions failed

The health check includes diagnostic data:
- `failed_destinations`: List of failed subscription addresses
- `recovering_destinations`: List of subscriptions currently retrying

### Connection Recovery

For transports that support connection recovery (RabbitMQ, Azure Service Bus), subscriptions are automatically re-established after connection loss:

1. Transport detects connection recovery
2. Worker receives recovery notification via `ITransportWithRecovery`
3. All subscriptions are reset to pending
4. Retry loop re-establishes each subscription

This ensures subscriptions survive both initial failures and runtime connection issues.

## Service Name Resolution

The consumer uses service name for subscription naming:

1. **`IServiceInstanceProvider`** - If registered, uses `ServiceName` property
2. **Entry Assembly** - Falls back to assembly name
3. **Default** - Uses "UnknownService" as ultimate fallback

Register a custom provider for explicit control:

```csharp
builder.Services.AddSingleton<IServiceInstanceProvider>(
    new ServiceInstanceProvider("MyOrderService"));
```

## Prerequisites

Before calling `AddTransportConsumer()`:

1. **Transport Registration** - Call `AddAzureServiceBusTransport()` or `AddRabbitMQTransport()`
2. **Routing Configuration** - Call `WithRouting()` to configure routing options
3. **Receptors** (optional) - Call `AddReceptors()` for message handlers

## Related Documentation

- [Routing](./routing.md) - Namespace-based routing configuration
- [Inbox/Outbox](./inbox-outbox.md) - Message persistence and delivery guarantees
- [Workers](./workers.md) - Background processing workers
- [RabbitMQ Transport](../components/transports/rabbitmq.md) - RabbitMQ transport configuration
- [Azure Service Bus Transport](../components/transports/azure-service-bus.md) - Azure Service Bus transport configuration
