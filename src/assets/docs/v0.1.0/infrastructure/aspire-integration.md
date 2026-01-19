---
title: ".NET Aspire Integration"
version: 0.1.0
category: Infrastructure
order: 1
description: "Cloud-native orchestration for Whizbang applications with .NET Aspire - automatic infrastructure provisioning and service discovery"
tags: aspire, cloud-native, orchestration, service-bus, emulator, infrastructure, distributed-applications
codeReferences:
  - src/Whizbang.Hosting.Azure.ServiceBus/ServiceBusSubscriptionExtensions.cs
  - src/Whizbang.Core/Transports/AzureServiceBus/AspireConfigurationGenerator.cs
  - src/Whizbang.Hosting.Azure.ServiceBus/ServiceBusReadinessCheck.cs
---

# .NET Aspire Integration

**.NET Aspire** is Microsoft's cloud-native application stack for building distributed applications with batteries-included infrastructure. Whizbang integrates seamlessly with Aspire to provide automatic service discovery, infrastructure provisioning, and local development environments.

## Why Aspire + Whizbang?

**Aspire solves infrastructure complexity** for Whizbang applications:

| Challenge | Without Aspire | With Aspire |
|-----------|---------------|-------------|
| **Service Bus Setup** | Manual topic/subscription creation | Automatic provisioning from AppHost |
| **Connection Strings** | Copy-paste from Azure Portal | Auto-injected via configuration |
| **Local Development** | Install/configure Service Bus locally | Built-in emulator with zero config |
| **Service Discovery** | Manual endpoint configuration | Automatic service-to-service discovery |
| **Health Checks** | Manual endpoint setup | Built-in dashboards with live monitoring |
| **Observability** | Configure OpenTelemetry manually | Auto-wired distributed tracing |

**Whizbang + Aspire Benefits**:
- ✅ **Zero Manual Infrastructure** - Topics, subscriptions, filters provisioned automatically
- ✅ **Emulator Support** - Local Service Bus emulator for dev/test
- ✅ **Configuration as Code** - AppHost defines infrastructure declaratively
- ✅ **Multi-Service Orchestration** - Run distributed systems locally with `dotnet run`
- ✅ **Production Parity** - Same code runs locally (emulator) and in Azure

---

## Architecture

### Aspire AppHost Pattern

```
┌────────────────────────────────────────────────────────┐
│  AppHost (Program.cs)                                  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Azure Service Bus Resource                      │ │
│  │  ├─ Topic: "whizbang.events"                     │ │
│  │  │  ├─ Subscription: "inventory-service"         │ │
│  │  │  │  └─ Filter: Destination = "inventory"      │ │
│  │  │  ├─ Subscription: "notification-service"      │ │
│  │  │  │  └─ Filter: Destination = "notifications"  │ │
│  │  │  └─ Subscription: "analytics-service"         │ │
│  │  │     └─ Filter: Destination = "analytics"      │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Service Projects (with references)              │ │
│  │  ├─ Inventory Service → inventory-service sub    │ │
│  │  ├─ Notification Service → notification-service  │ │
│  │  └─ Analytics Service → analytics-service sub    │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
         │
         │ dotnet run (AppHost)
         ▼
┌────────────────────────────────────────────────────────┐
│  Aspire Runtime                                        │
│                                                         │
│  - Starts Service Bus emulator (or connects to Azure) │
│  - Provisions topics and subscriptions via Bicep/API  │
│  - Injects connection strings into services           │
│  - Starts all service projects                        │
│  - Exposes dashboard at http://localhost:15888        │
└────────────────────────────────────────────────────────┘
```

---

## Setup

### 1. Create Aspire AppHost Project

```bash
# Create solution structure
dotnet new sln -n MyDistributedApp
dotnet new aspire-apphost -n MyDistributedApp.AppHost
dotnet sln add MyDistributedApp.AppHost

# Add service projects
dotnet new webapi -n InventoryService
dotnet new webapi -n NotificationService
dotnet sln add InventoryService NotificationService
```

### 2. Add Whizbang NuGet Packages

**AppHost Project**:
```bash
cd MyDistributedApp.AppHost
dotnet add package Whizbang.Hosting.Azure.ServiceBus
```

**Service Projects**:
```bash
cd ../InventoryService
dotnet add package Whizbang
dotnet add package Whizbang.Transports.AzureServiceBus
```

### 3. Configure AppHost

**AppHost/Program.cs**:
```csharp
using Whizbang.Hosting.Azure.ServiceBus;

var builder = DistributedApplication.CreateBuilder(args);

// Add Service Bus resource (emulator for local dev)
var serviceBus = builder.AddAzureServiceBus("messaging")
  .RunAsEmulator();  // Local development
  // .PublishAsAzureServiceBusNamespace();  // Production deployment

// Create topic for all events
var topic = serviceBus.AddTopic("whizbang-events");

// Add subscriptions with Whizbang correlation filters
var inventorySub = topic.AddSubscription("inventory-service")
  .WithDestinationFilter("inventory");  // ⭐ Whizbang extension method

var notificationSub = topic.AddSubscription("notification-service")
  .WithDestinationFilter("notifications");

var analyticsSub = topic.AddSubscription("analytics-service")
  .WithDestinationFilter("analytics");

// Add service projects with Service Bus references
var inventoryService = builder.AddProject<Projects.InventoryService>("inventory-service")
  .WithReference(serviceBus)
  .WithReference(inventorySub);  // Grants read access to subscription

var notificationService = builder.AddProject<Projects.NotificationService>("notification-service")
  .WithReference(serviceBus)
  .WithReference(notificationSub);

var analyticsService = builder.AddProject<Projects.AnalyticsService>("analytics-service")
  .WithReference(serviceBus)
  .WithReference(analyticsSub);

builder.Build().Run();
```

**What `.WithDestinationFilter()` Does**:
- Provisions Azure Service Bus **Correlation Filter** on the subscription
- Filters messages based on `ApplicationProperties["Destination"]` value
- Enables multi-tenant and multi-service routing patterns
- Works in both emulator and production

---

## Service Configuration

### 1. Add Aspire Service Defaults

**InventoryService/Program.cs**:
```csharp
var builder = WebApplication.CreateBuilder(args);

// Add Aspire service defaults (health checks, telemetry, service discovery)
builder.AddServiceDefaults();  // ⭐ Essential for Aspire integration

// Get Service Bus connection string injected by Aspire
var connectionString = builder.Configuration.GetConnectionString("messaging")
  ?? throw new InvalidOperationException("Service Bus connection not found");

// Register Whizbang transport
builder.Services.AddAzureServiceBusTransport(connectionString);

// Register receptors, perspectives, etc.
builder.Services.AddWhizbang();

var app = builder.Build();
app.MapDefaultEndpoints();  // Health checks, metrics

app.Run();
```

**How It Works**:
1. Aspire injects `ConnectionStrings:messaging` into app configuration
2. Service reads connection string and registers transport
3. Transport auto-detects emulator vs. production connection
4. Aspire dashboard shows service health and telemetry

### 2. Verify Aspire Integration

```bash
# Run AppHost
cd MyDistributedApp.AppHost
dotnet run

# Aspire dashboard opens at http://localhost:15888
# View:
# - Resources (Service Bus, services)
# - Service health status
# - Distributed traces
# - Logs (structured and correlated)
```

---

## Correlation Filters

### WithDestinationFilter Extension

**Purpose**: Route messages to specific services based on `Destination` property.

**Implementation**:
```csharp
public static IResourceBuilder<AzureServiceBusSubscriptionResource> WithDestinationFilter(
  this IResourceBuilder<AzureServiceBusSubscriptionResource> subscription,
  string destination
) {
  return subscription.WithProperties(sub => {
    sub.Rules.Add(new AzureServiceBusRule("DestinationFilter") {
      CorrelationFilter = new() {
        Properties = { ["Destination"] = destination }
      }
    });
  });
}
```

**Usage Pattern**:
```csharp
// AppHost - provision filters
var inventorySub = topic.AddSubscription("inventory-service")
  .WithDestinationFilter("inventory");  // Only messages with Destination = "inventory"

// Publisher - set Destination property
var destination = new TransportDestination(
  Address: "whizbang-events",
  RoutingKey: "inventory-service",
  Metadata: new Dictionary<string, JsonElement> {
    ["Destination"] = JsonSerializer.SerializeToElement("inventory")  // ⭐ Filter value
  }
);

await transport.PublishAsync(envelope, destination);
```

**Result**: Only messages with `Destination = "inventory"` routed to `inventory-service` subscription.

---

## Emulator vs Production

### Development (Emulator)

```csharp
var serviceBus = builder.AddAzureServiceBus("messaging")
  .RunAsEmulator();  // Starts container with Service Bus emulator
```

**Characteristics**:
- Runs in Docker container
- Accessed via `localhost:5672` (AMQP)
- No Admin API (port 443 not supported)
- Filters provisioned by Aspire at startup
- Zero Azure credentials required

**Connection String**:
```
Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true
```

### Production (Azure)

```csharp
var serviceBus = builder.AddAzureServiceBus("messaging")
  .PublishAsAzureServiceBusNamespace();  // Generates Bicep for Azure deployment
```

**Characteristics**:
- Provisions Azure Service Bus Namespace
- Generates Bicep infrastructure-as-code
- Uses Azure identity for authentication
- Full Admin API support for filter management

**Connection String** (injected by Azure):
```
Endpoint=sb://my-namespace.servicebus.windows.net/;...
```

---

## Configuration Generation

### AspireConfigurationGenerator

**Purpose**: Generate C# code for AppHost based on service requirements.

**Use Case**: Services define their messaging requirements programmatically, generator creates AppHost config.

**Example**:
```csharp
using Whizbang.Core.Transports.AzureServiceBus;

// Service defines requirements
var requirements = new[] {
  new TopicRequirement("whizbang-events", "inventory-service"),
  new TopicRequirement("whizbang-events", "notification-service"),
  new TopicRequirement("order-events", "shipping-service")
};

// Generate AppHost code
var code = AspireConfigurationGenerator.GenerateAppHostCode(
  requirements,
  serviceName: "OrderService"
);

Console.WriteLine(code);
```

**Generated Output**:
```csharp
// === Whizbang Service Bus Configuration ===
// Service Bus topics for OrderService service

var orderEventsTopic = serviceBus.AddServiceBusTopic("order-events");
orderEventsTopic.AddServiceBusSubscription("shipping-service");

var whizbangEventsTopic = serviceBus.AddServiceBusTopic("whizbang-events");
whizbangEventsTopic.AddServiceBusSubscription("inventory-service");
whizbangEventsTopic.AddServiceBusSubscription("notification-service");

// ==========================================
```

**Use Case**: Copy-paste into AppHost to provision topics/subscriptions.

---

## Readiness Checks

### ServiceBusReadinessCheck

**Purpose**: Verify Service Bus connectivity before accepting traffic.

**Pattern**:
```csharp
using Whizbang.Hosting.Azure.ServiceBus;

builder.Services.AddSingleton<ITransportReadinessCheck, ServiceBusReadinessCheck>();
```

**How It Works**:
```csharp
public async Task<bool> IsReadyAsync(CancellationToken ct) {
  // 1. Check if transport initialized
  if (!_transport.IsInitialized) {
    return false;
  }

  // 2. Check cache (30-second TTL)
  if (_lastSuccessfulCheck.HasValue &&
      DateTimeOffset.UtcNow - _lastSuccessfulCheck.Value < _cacheDuration) {
    return true;  // Cached result
  }

  // 3. Verify ServiceBusClient is open
  if (_client.IsClosed) {
    return false;
  }

  // 4. Cache successful check
  _lastSuccessfulCheck = DateTimeOffset.UtcNow;
  return true;
}
```

**Benefits**:
- Prevents accepting requests before Service Bus connection is ready
- Cached checks avoid excessive health check overhead
- Integrates with Aspire dashboard for real-time status

---

## Multi-Service Patterns

### Fan-Out Events

```csharp
// AppHost - multiple services subscribe to same topic
var topic = serviceBus.AddTopic("order-events");

topic.AddSubscription("inventory-service")
  .WithDestinationFilter("inventory");

topic.AddSubscription("notification-service")
  .WithDestinationFilter("notifications");

topic.AddSubscription("analytics-service")
  .WithDestinationFilter("analytics");

topic.AddSubscription("audit-service")
  .WithDestinationFilter("audit");

// Publisher - send to multiple destinations
await transport.PublishAsync(envelope, new TransportDestination("order-events", Metadata: CreateDestination("inventory")));
await transport.PublishAsync(envelope, new TransportDestination("order-events", Metadata: CreateDestination("notifications")));
await transport.PublishAsync(envelope, new TransportDestination("order-events", Metadata: CreateDestination("audit")));
```

**Result**: Single event published to multiple services via correlation filters.

### Service-to-Service Communication

```csharp
// AppHost - inventory service references notification service
var notificationService = builder.AddProject<Projects.NotificationService>("notification-service")
  .WithReference(serviceBus);

var inventoryService = builder.AddProject<Projects.InventoryService>("inventory-service")
  .WithReference(serviceBus)
  .WithReference(notificationService);  // Service discovery

// InventoryService - call NotificationService
var notificationEndpoint = builder.Configuration["services:notification-service:https:0"];
var httpClient = new HttpClient { BaseAddress = new Uri(notificationEndpoint) };

await httpClient.PostAsync("/notify", content);  // Service-to-service HTTP
```

**Aspire provides**:
- Automatic service endpoint discovery
- Load balancing across instances
- Health-based routing

---

## Dashboard and Observability

### Aspire Dashboard

Run AppHost and open **http://localhost:15888**.

**Features**:
- **Resources Tab**: View Service Bus, services, dependencies
- **Console Logs Tab**: Structured logs with correlation IDs
- **Traces Tab**: Distributed tracing across services
- **Metrics Tab**: Service health, request rates, latencies

### Whizbang Integration

**Automatic Tracing**:
- All `IDispatcher.SendAsync` calls create spans
- Transport `PublishAsync` and `SubscribeAsync` tracked
- Correlation IDs propagated across services

**Example Trace**:
```
OrderService.DispatcherInvokeReceptor (50ms)
  ├─ OrderReceptor.HandleAsync (45ms)
  │  ├─ Database.Insert (10ms)
  │  └─ Transport.PublishAsync (5ms)
  │
  └─ InventoryService.ReceiveMessage (20ms)
     └─ InventoryReceptor.HandleAsync (18ms)
        └─ Database.Update (15ms)
```

---

## Best Practices

### DO ✅

- ✅ **Use `.WithDestinationFilter()`** for multi-service routing
- ✅ **Run emulator for local development** (zero Azure costs)
- ✅ **Add `.AddServiceDefaults()`** to all service projects
- ✅ **Reference subscriptions** via `.WithReference()` (grants access)
- ✅ **Use `PublishAsAzureServiceBusNamespace()`** for production Bicep generation
- ✅ **Monitor Aspire dashboard** during development
- ✅ **Test locally with emulator** before deploying to Azure

### DON'T ❌

- ❌ Hardcode connection strings (use Aspire configuration)
- ❌ Skip `.AddServiceDefaults()` (breaks health checks and telemetry)
- ❌ Create topics/subscriptions manually (let Aspire provision)
- ❌ Use Admin API with emulator (not supported)
- ❌ Ignore readiness checks (services may accept traffic before ready)
- ❌ Deploy to production without testing emulator first

---

## Troubleshooting

### Problem: "Connection string 'messaging' not found"

**Symptoms**: Service fails to start with missing connection string error.

**Cause**: Service not referenced in AppHost or missing `.WithReference(serviceBus)`.

**Solution**:
```csharp
// AppHost - add reference to Service Bus
var inventoryService = builder.AddProject<Projects.InventoryService>("inventory-service")
  .WithReference(serviceBus);  // ⭐ Required for connection string injection

// Service - verify configuration key
var connectionString = builder.Configuration.GetConnectionString("messaging");
// Key must match resource name in AppHost ("messaging")
```

### Problem: Messages Not Filtered Correctly

**Symptoms**: Subscriber receives all messages, not just filtered ones.

**Causes**:
1. Filter not provisioned (missing `.WithDestinationFilter()`)
2. Publisher not setting `Destination` property
3. Filter value mismatch

**Solution**:
```csharp
// AppHost - verify filter provisioning
var inventorySub = topic.AddSubscription("inventory-service")
  .WithDestinationFilter("inventory");  // Filter value: "inventory"

// Publisher - set matching Destination property
var metadata = new Dictionary<string, JsonElement> {
  ["Destination"] = JsonSerializer.SerializeToElement("inventory")  // Must match filter
};

var destination = new TransportDestination("whizbang-events", "inventory-service", metadata);
await transport.PublishAsync(envelope, destination);

// Verify in Azure Portal:
// Service Bus Namespace → Topics → whizbang-events → Subscriptions → inventory-service → Rules
// Expected: DestinationFilter with Destination = "inventory"
```

### Problem: Emulator Fails to Start

**Symptoms**: AppHost throws error starting Service Bus emulator.

**Causes**:
1. Docker not running
2. Port 5672 already in use
3. Emulator image not pulled

**Solution**:
```bash
# Verify Docker is running
docker ps

# Pull Service Bus emulator image
docker pull mcr.microsoft.com/azure-messaging/servicebus-emulator:latest

# Check port availability
lsof -i :5672  # Should be empty

# Run AppHost again
dotnet run
```

### Problem: Service Not Appearing in Dashboard

**Symptoms**: Aspire dashboard shows Service Bus but not service projects.

**Cause**: Missing `.AddServiceDefaults()` in service `Program.cs`.

**Solution**:
```csharp
// Service Program.cs - add service defaults
var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();  // ⭐ Required for dashboard integration

var app = builder.Build();
app.MapDefaultEndpoints();  // Exposes health/metrics endpoints
app.Run();
```

---

## Further Reading

**Transports**:
- [Azure Service Bus Transport](../transports/azure-service-bus.md) - Service Bus integration details

**Infrastructure**:
- [Health Checks](health-checks.md) - Application health monitoring
- [Policies](policies.md) - Policy-based routing

**Messaging**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable event publishing
- [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once processing

**External Resources**:
- [.NET Aspire Documentation](https://learn.microsoft.com/en-us/dotnet/aspire/)
- [Azure Service Bus Emulator](https://learn.microsoft.com/en-us/azure/service-bus-messaging/overview-emulator)

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
