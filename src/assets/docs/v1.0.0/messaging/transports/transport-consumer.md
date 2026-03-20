---
title: Transport Consumer
version: 1.0.0
category: Core Concepts
description: >-
  Configure transport message consumption with auto-generated subscriptions,
  subscription resilience, and connection recovery support
tags: 'transport, consumer, subscriptions, resilience, messaging'
codeReferences:
  - src/Whizbang.Core/Workers/TransportConsumerBuilderExtensions.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
  - src/Whizbang.Core/Resilience/SubscriptionResilienceOptions.cs
  - src/Whizbang.Core/Resilience/SubscriptionState.cs
  - src/Whizbang.Core/Resilience/SubscriptionRetryHelper.cs
  - src/Whizbang.Core/Transports/ITransportWithRecovery.cs
---

# Transport Consumer

The transport consumer automatically subscribes to message broker destinations and processes incoming messages. When combined with `WithRouting()`, subscriptions are auto-generated from your routing configuration.

## Overview

The `AddTransportConsumer()` extension method:

1. **Auto-generates subscriptions** from `RoutingOptions` configured via `WithRouting()`
2. **Registers `TransportConsumerOptions`** with populated destinations
3. **Starts `TransportConsumerWorker`** as a hosted service

## Auto-Configuration {#auto-configuration}

The recommended approach chains `WithRouting()` and `AddTransportConsumer()`:

```csharp{title="Auto-Configuration" description="The recommended approach chains WithRouting() and AddTransportConsumer():" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Auto-Configuration", "Auto-configuration"]}
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

```csharp{title="Additional Destinations" description="Add custom destinations beyond auto-generated ones:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Additional", "Destinations"]}
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

```csharp{title="Complete Worker Setup" description="A typical worker service includes transport registration, routing, and consumer:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Complete", "Worker"]}
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

```csharp{title="Error Handling" description="When WithRouting() is not called before AddTransportConsumer():" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Error", "Handling"]}
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

### Core Types

**SubscriptionResilienceOptions**:
Configuration options for subscription retry behavior. Controls exponential backoff, retry limits, and partial subscription handling.

**SubscriptionStatus**:
Enumeration tracking subscription states:
- `Pending` - Waiting to subscribe
- `Active` - Successfully subscribed
- `Recovering` - Retrying after failure
- `Failed` - Failed (when `RetryIndefinitely = false`)

**SubscriptionState**:
Tracks the current state of each subscription, including destination, status, error messages, and retry count.

**SubscriptionRetryHelper**:
Internal helper class that implements exponential backoff logic and retry coordination.

### Retry Behavior

The retry system uses **exponential backoff**:

| Property | Default | Description |
|----------|---------|-------------|
| `InitialRetryDelay` | 1 second | Starting delay between retries |
| `MaxRetryDelay` | 120 seconds | Cap on exponential backoff |
| `BackoffMultiplier` | 2.0 | Delay multiplier per attempt |
| `InitialRetryAttempts` | 5 | Attempts before reducing log verbosity |
| `RetryIndefinitely` | true | Never give up (recommended) |
| `HealthCheckInterval` | 1 minute | Interval for health check sweeps |
| `AllowPartialSubscriptions` | true | Start with partial subscriptions |

**How Exponential Backoff Works**:

```
Attempt 1: 1 second delay
Attempt 2: 2 seconds delay (1 * 2.0)
Attempt 3: 4 seconds delay (2 * 2.0)
Attempt 4: 8 seconds delay (4 * 2.0)
Attempt 5: 16 seconds delay (8 * 2.0)
Attempt 6: 32 seconds delay (16 * 2.0)
Attempt 7: 64 seconds delay (32 * 2.0)
Attempt 8: 120 seconds delay (64 * 2.0, capped at MaxRetryDelay)
Attempt 9+: 120 seconds delay (continues at max)
```

### Configuration

Customize resilience behavior through `TransportConsumerConfiguration`:

```csharp{title="Configuration" description="Customize resilience behavior through TransportConsumerConfiguration:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Configuration"]}
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

        // Custom health check interval
        config.ResilienceOptions.HealthCheckInterval = TimeSpan.FromSeconds(30);
    });
```

### Health Monitoring

When resilience is enabled, a health check is automatically registered:

```csharp{title="Health Monitoring" description="When resilience is enabled, a health check is automatically registered:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Health", "Monitoring"]}
app.MapHealthChecks("/health");  // Includes subscription health
```

Health check results:
- **Healthy**: All subscriptions active
- **Degraded**: Some subscriptions recovering or pending
- **Unhealthy**: All subscriptions failed

The health check includes diagnostic data:
- `failed_destinations`: List of failed subscription addresses
- `recovering_destinations`: List of subscriptions currently retrying
- `pending_destinations`: List of subscriptions waiting for first attempt

### Connection Recovery

For transports that support connection recovery (RabbitMQ, Azure Service Bus), subscriptions are automatically re-established after connection loss:

1. Transport detects connection recovery
2. Worker receives recovery notification via `ITransportWithRecovery`
3. All subscriptions are reset to pending
4. Retry loop re-establishes each subscription

This ensures subscriptions survive both initial failures and runtime connection issues.

### Observability

Monitor subscription state through:

**Logging**:
- Initial retries (attempts 1-5): Warning level with full details
- Indefinite retries (attempts 6+): Info level with reduced verbosity

**Metrics** (if using health checks):
- Total subscriptions count
- Active subscriptions count
- Failed subscriptions count
- Recovering subscriptions count

**Diagnostic Data**:
Access subscription state programmatically through the health check data dictionary.

## Service Name Resolution

The consumer uses service name for subscription naming:

1. **`IServiceInstanceProvider`** - If registered, uses `ServiceName` property
2. **Entry Assembly** - Falls back to assembly name
3. **Default** - Uses "UnknownService" as ultimate fallback

Register a custom provider for explicit control:

```csharp{title="Service Name Resolution" description="Register a custom provider for explicit control:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Service", "Name"]}
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
- [RabbitMQ Transport](./rabbitmq.md) - RabbitMQ transport configuration
- [Azure Service Bus Transport](./azure-service-bus.md) - Azure Service Bus transport configuration
