---
title: Transport Configuration
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Migration Guide
order: 7
description: Configuring RabbitMQ and Azure Service Bus transports for Whizbang
tags: 'migration, transport, rabbitmq, azure-service-bus, messaging'
codeReferences:
  - src/Whizbang.Transports.RabbitMQ/ServiceCollectionExtensions.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMQOptions.cs
  - src/Whizbang.Transports.AzureServiceBus/ServiceCollectionExtensions.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusOptions.cs
  - src/Whizbang.Core/Routing/RoutingBuilderExtensions.cs
testReferences:
  - tests/Whizbang.Transports.RabbitMQ.Tests/ServiceCollectionExtensionsBranchCoverageTests.cs
  - tests/Whizbang.Transports.AzureServiceBus.Tests/ServiceCollectionExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Routing/RoutingBuilderExtensionsTests.cs
lastMaintainedCommit: '01f07906'
---

# Transport Configuration

This guide covers configuring message transports in Whizbang, including environment-based switching between RabbitMQ (local development) and Azure Service Bus (production).

## Transport Options

| Transport | Package | Use Case |
|-----------|---------|----------|
| RabbitMQ | `SoftwareExtravaganza.Whizbang.Transports.RabbitMQ` | Local development, Aspire |
| Azure Service Bus | `SoftwareExtravaganza.Whizbang.Transports.AzureServiceBus` | Production, Azure deployment |
| None (local dispatch) | Built-in | Unit testing (no transport registration needed) |

## Environment-Based Transport Switching

### Recommended Pattern: Runtime Configuration

```csharp{title="Recommended Pattern: Runtime Configuration" description="Recommended Pattern: Runtime Configuration" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Recommended", "Pattern:", "Runtime"]}
var builder = WebApplication.CreateBuilder(args);

// Core Whizbang setup (storage; connection string resolved from configuration)
builder.Services
    .AddWhizbang()
    .WithEFCore<AppDbContext>("postgres")
    .WithDriver.Postgres;

// Transport switching based on configuration
var useRabbitMQ = builder.Configuration.GetValue<bool>("UseRabbitMQ");

if (useRabbitMQ) {
    // Local development with Aspire/RabbitMQ
    builder.Services.AddRabbitMQTransport(
        builder.Configuration.GetConnectionString("rabbitmq")!,
        options => {
            options.MaxChannels = 10;
            options.PrefetchCount = 200;
        });

    builder.Services.AddRabbitMQHealthChecks();
} else {
    // Production with Azure Service Bus
    builder.Services.AddAzureServiceBusTransport(
        builder.Configuration.GetConnectionString("servicebus")!,
        options => {
            options.MaxConcurrentCalls = 16;
            options.DefaultSubscriptionName = "order-service";
        });

    builder.Services.AddAzureServiceBusHealthChecks();
}
```

### Configuration Files

**appsettings.Development.json**:

```json{title="Configuration Files" description="**appsettings." category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "Json", "Configuration", "Files"]}
{
  "UseRabbitMQ": true,
  "ConnectionStrings": {
    "postgres": "Host=localhost;Database=myapp;Username=postgres;Password=postgres",
    "rabbitmq": "amqp://guest:guest@localhost:5672"
  }
}
```

**appsettings.Production.json**:

```json{title="Configuration Files (2)" description="**appsettings." category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "Json", "Configuration", "Files"]}
{
  "UseRabbitMQ": false,
  "ConnectionStrings": {
    "postgres": "Host=myapp.postgres.database.azure.com;Database=myapp;...",
    "servicebus": "Endpoint=sb://myapp.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=..."
  }
}
```

> **Note**: Transport options (`RabbitMQOptions`, `AzureServiceBusOptions`) are configured through the callback passed to the `Add*Transport` registration, not bound from configuration sections. Topics, exchanges, and subscriptions are auto-provisioned from your routing configuration (see [Message Routing](#message-routing) below) — there is no manual exchange/topic naming option on the transport itself.

## RabbitMQ Configuration

### Basic Setup

```csharp{title="Basic Setup" description="Basic Setup" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Setup"]}
builder.Services.AddRabbitMQTransport(
    builder.Configuration.GetConnectionString("rabbitmq")!);
```

### Advanced Configuration

```csharp{title="Advanced Configuration" description="Advanced Configuration" category="Reference" difficulty="ADVANCED" tags=["Migration-guide", "C#", "Advanced", "Configuration"]}
builder.Services.AddRabbitMQTransport(
    builder.Configuration.GetConnectionString("rabbitmq")!,
    options => {
        // Channel pooling
        options.MaxChannels = 10;

        // Consumer configuration
        options.PrefetchCount = 200;
        options.EnableSingleActiveConsumer = false;

        // Delivery / dead-lettering
        options.MaxDeliveryAttempts = 10;
        options.AutoDeclareDeadLetterExchange = true;

        // Connection retry (initial attempts, then optionally indefinite)
        options.InitialRetryAttempts = 5;
        options.InitialRetryDelay = TimeSpan.FromSeconds(1);
        options.MaxRetryDelay = TimeSpan.FromSeconds(120);
        options.BackoffMultiplier = 2.0;
        options.RetryIndefinitely = true;
    });

// Add health checks (registers the Whizbang RabbitMQ health check)
builder.Services.AddRabbitMQHealthChecks();
```

### Aspire Integration

```csharp{title="Aspire Integration" description="Aspire Integration" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Aspire", "Integration"]}
// In AppHost project
var rabbitmq = builder.AddRabbitMQ("rabbitmq")
    .WithManagementPlugin();

var api = builder.AddProject<Projects.MyApp_API>("api")
    .WithReference(rabbitmq);
```

```csharp{title="Aspire Integration (2)" description="Aspire Integration" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Aspire", "Integration"]}
// In API project - Aspire injects the connection string into configuration
builder.Services.AddRabbitMQTransport(
    builder.Configuration.GetConnectionString("rabbitmq")!);
```

## Azure Service Bus Configuration

### Basic Setup

```csharp{title="Basic Setup (2)" description="Basic Setup" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Setup"]}
builder.Services.AddAzureServiceBusTransport(
    builder.Configuration.GetConnectionString("servicebus")!);
```

### Advanced Configuration

```csharp{title="Advanced Configuration (2)" description="Advanced Configuration" category="Reference" difficulty="ADVANCED" tags=["Migration-guide", "C#", "Advanced", "Configuration"]}
builder.Services.AddAzureServiceBusTransport(
    builder.Configuration.GetConnectionString("servicebus")!,
    options => {
        // Infrastructure auto-provisioning (topics + subscriptions)
        options.AutoProvisionInfrastructure = true;
        options.DefaultSubscriptionName = "order-service";

        // Consumer concurrency
        options.MaxConcurrentCalls = 16;
        options.PrefetchCount = 50;

        // Session handling (per-stream ordered processing)
        options.EnableSessions = true;
        options.MaxConcurrentSessions = 200;
        options.SessionIdleTimeout = TimeSpan.FromSeconds(1);

        // Delivery / locks
        options.MaxDeliveryAttempts = 10;
        options.MaxAutoLockRenewalDuration = TimeSpan.FromMinutes(5);

        // Connection retry
        options.InitialRetryAttempts = 5;
        options.InitialRetryDelay = TimeSpan.FromSeconds(1);
        options.RetryIndefinitely = true;
    });

// Add health checks (registers the Whizbang Service Bus health check)
builder.Services.AddAzureServiceBusHealthChecks();
```

### Managed Identity Authentication

`AddAzureServiceBusTransport` takes a connection string, but it reuses any `ServiceBusClient` you have already registered. To authenticate with a managed identity, register the client yourself first:

```csharp{title="Managed Identity Authentication" description="Managed Identity Authentication" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Managed", "Identity", "Authentication"]}
// Pre-register a ServiceBusClient using DefaultAzureCredential;
// the transport registration detects and reuses it.
builder.Services.AddSingleton(new ServiceBusClient(
    "myapp.servicebus.windows.net",
    new DefaultAzureCredential()));

builder.Services.AddAzureServiceBusTransport(
    builder.Configuration.GetConnectionString("servicebus")!);
```

## Migrating from Wolverine Transports

### Wolverine RabbitMQ

```csharp{title="Wolverine RabbitMQ" description="Wolverine RabbitMQ" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Wolverine", "RabbitMQ"]}
// Wolverine
builder.Host.UseWolverine(opts => {
    opts.UseRabbitMq("amqp://guest:guest@localhost:5672")
        .UseConventionalRouting()
        .UseDurableOutbox();
});
```

```csharp{title="Wolverine RabbitMQ (2)" description="Wolverine RabbitMQ" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Wolverine", "RabbitMQ"]}
// Whizbang
// - Outbox is built-in to Whizbang Core (no UseDurableOutbox equivalent needed)
// - Exchanges are auto-provisioned from routing configuration
builder.Services.AddRabbitMQTransport("amqp://guest:guest@localhost:5672");
```

### Wolverine Azure Service Bus

```csharp{title="Wolverine Azure Service Bus" description="Wolverine Azure Service Bus" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Wolverine", "Azure", "Service"]}
// Wolverine
builder.Host.UseWolverine(opts => {
    opts.UseAzureServiceBus(connectionString)
        .UseTopicsAndSubscriptions()
        .UseDurableOutbox();
});
```

```csharp{title="Wolverine Azure Service Bus (2)" description="Wolverine Azure Service Bus" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Wolverine", "Azure", "Service"]}
// Whizbang
// Topics and subscriptions are auto-provisioned from routing configuration
builder.Services.AddAzureServiceBusTransport(connectionString);
```

## Message Routing

Routing is namespace-based: events publish to topics derived from their namespace, and commands route point-to-point through a shared inbox topic. Configure it with `WithRouting` on the builder chain:

```csharp{title="Namespace-Based Routing" description="Namespace-Based Routing" category="Reference" difficulty="BEGINNER" tags=["Migration-Guide", "Topic-Based", "Routing"]}
builder.Services
    .AddWhizbang()
    .WithRouting(routing => {
        // Domains this service owns (its own command/event namespaces)
        routing.OwnDomains("myapp.orders.commands", "myapp.orders.events");

        // Or derive the namespace from a marker type
        routing.OwnNamespaceOf<OrderCreated>();

        // Event namespaces published by OTHER services that this service consumes
        routing.SubscribeTo("myapp.payments.events");
        routing.SubscribeToNamespaceOf<PaymentProcessed>();

        // Commands arrive on a shared inbox topic (the default strategy)
        routing.Inbox.UseSharedTopic("whizbang.inbox");
    })
    .AddTransportConsumer(); // Auto-generates transport subscriptions from routing config
```

Per-message-type topic overrides and SQL-style subscription filters are not part of the routing API — topics come from namespaces, and receive-side filtering happens automatically (messages with no local receptor or perspective are discarded at the receive boundary).

## Testing Configuration

### In-Memory Transport for Tests

```csharp{title="In-Memory Transport for Tests" description="In-Memory Transport for Tests" category="Reference" difficulty="BEGINNER" tags=["Migration-Guide", "In-Memory", "Transport", "Tests"]}
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

```csharp{title="Integration Test with TestContainers" description="Integration Test with TestContainers" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Integration", "Test", "TestContainers"]}
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
