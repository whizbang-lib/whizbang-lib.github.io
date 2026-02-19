---
title: "Azure Service Bus Transport"
version: 0.1.0
category: Transports
order: 1
description: "Reliable cross-service messaging with Azure Service Bus topics and subscriptions - AOT-compatible with correlation filters"
tags: transports, azure-service-bus, messaging, topics, subscriptions, correlation-filters, aspire, aot
codeReferences:
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusTransport.cs
  - src/Whizbang.Transports.AzureServiceBus/ServiceCollectionExtensions.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusOptions.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusConnectionRetry.cs
  - src/Whizbang.Hosting.Azure.ServiceBus/ServiceBusSubscriptionExtensions.cs
testReferences:
  - tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusConnectionRetryTests.cs
---

# Azure Service Bus Transport

The **Azure Service Bus transport** provides reliable, ordered message delivery across services using Azure Service Bus topics and subscriptions. This enables pub/sub patterns with correlation-based routing for multi-tenant and distributed architectures.

## Why Azure Service Bus?

**Azure Service Bus** offers enterprise-grade messaging with:

| Feature | Description | Benefit |
|---------|-------------|---------|
| **Topics & Subscriptions** | Publish once, multiple subscribers | True pub/sub pattern |
| **Correlation Filters** | Route messages by properties | Multi-tenant isolation |
| **At-Least-Once Delivery** | Guaranteed message delivery | Reliability |
| **Message Ordering** | FIFO within sessions | Consistency |
| **Dead Letter Queue** | Automatic failure handling | Observability |
| **Lock Renewal** | Automatic lock extension | Long-running handlers |

**Whizbang Integration**:
- ✅ **AOT-Compatible** - Uses `JsonContextRegistry` for serialization
- ✅ **Aspire Integration** - First-class support for .NET Aspire orchestration
- ✅ **Correlation Filters** - Automatic routing based on message properties
- ✅ **Emulator Support** - Works with Aspire Service Bus emulator
- ✅ **Observability** - OpenTelemetry tracing for all operations

---

## Architecture

### Topic/Subscription Pattern

```
┌────────────────────────────────────────────────────────┐
│  Azure Service Bus Namespace                           │
│                                                         │
│  ┌────────────────────────────────────────────────┐   │
│  │  Topic: "whizbang.events"                      │   │
│  │                                                 │   │
│  │  ┌──────────────────────────────────────────┐ │   │
│  │  │  Subscription: "inventory-service"       │ │   │
│  │  │  Filter: Destination = "inventory"       │ │   │
│  │  │  → Inventory Service                     │ │   │
│  │  └──────────────────────────────────────────┘ │   │
│  │                                                 │   │
│  │  ┌──────────────────────────────────────────┐ │   │
│  │  │  Subscription: "notification-service"    │ │   │
│  │  │  Filter: Destination = "notifications"   │ │   │
│  │  │  → Notification Service                  │ │   │
│  │  └──────────────────────────────────────────┘ │   │
│  │                                                 │   │
│  │  ┌──────────────────────────────────────────┐ │   │
│  │  │  Subscription: "analytics-service"       │ │   │
│  │  │  Filter: Destination = "analytics"       │ │   │
│  │  │  → Analytics Service                     │ │   │
│  │  └──────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

### Message Flow

```
Publisher (Order Service)
  │
  │ 1. PublishAsync(envelope, destination)
  │    Destination: "inventory"
  ▼
┌─────────────────────────────────────┐
│  AzureServiceBusTransport           │
│                                     │
│  - Serialize MessageEnvelope        │
│  - Set ApplicationProperties:       │
│    • MessageId                      │
│    • CorrelationId                  │
│    • CausationId                    │
│    • Destination = "inventory"      │
└─────────────────────────────────────┘
  │
  │ 2. SendMessageAsync()
  ▼
┌─────────────────────────────────────┐
│  Azure Service Bus Topic            │
│  "whizbang.events"                  │
└─────────────────────────────────────┘
  │
  │ 3. Correlation Filter
  │    WHERE Destination = "inventory"
  ▼
┌─────────────────────────────────────┐
│  Subscription: "inventory-service"  │
│  (Only messages with matching       │
│   Destination property)             │
└─────────────────────────────────────┘
  │
  │ 4. ProcessMessageAsync()
  ▼
┌─────────────────────────────────────┐
│  Inventory Service Subscriber       │
│                                     │
│  - Deserialize MessageEnvelope      │
│  - Extract metadata (IDs, hops)     │
│  - Invoke handler                   │
│  - Complete or Abandon message      │
└─────────────────────────────────────┘
```

---

## Configuration

### 1. Add NuGet Package

```bash
dotnet add package Whizbang.Transports.AzureServiceBus
```

### 2. Register Transport (Standard .NET)

```csharp
using Whizbang.Transports.AzureServiceBus;

var builder = WebApplication.CreateBuilder(args);

// Register Azure Service Bus transport
builder.Services.AddAzureServiceBusTransport(
  connectionString: "Endpoint=sb://...",
  configureOptions: options => {
    options.MaxConcurrentCalls = 20;              // Default: 10
    options.MaxAutoLockRenewalDuration = TimeSpan.FromMinutes(5);
    options.MaxDeliveryAttempts = 10;             // Default: 10
    options.DefaultSubscriptionName = "default";  // Default: "default"
  }
);

// Optional: Add health checks
builder.Services.AddAzureServiceBusHealthChecks();

var app = builder.Build();
app.Run();
```

### 3. Register Transport (.NET Aspire)

**.NET Aspire App Host** (`AppHost/Program.cs`):

```csharp
var builder = DistributedApplication.CreateBuilder(args);

// Add Azure Service Bus resource (or emulator)
var serviceBus = builder.AddAzureServiceBus("messaging")
  .RunAsEmulator();  // Or .PublishAsAzureServiceBusNamespace() for production

// Add topic with subscriptions
var topic = serviceBus.AddTopic("whizbang-events");

// Inventory service subscription with correlation filter
var inventorySub = topic.AddSubscription("inventory-service")
  .WithDestinationFilter("inventory");  // Whizbang extension method

var notificationSub = topic.AddSubscription("notification-service")
  .WithDestinationFilter("notifications");

// Add service projects with references
var inventoryService = builder.AddProject<Projects.InventoryService>("inventory-service")
  .WithReference(serviceBus)
  .WithReference(inventorySub);  // Grants access to subscription

var notificationService = builder.AddProject<Projects.NotificationService>("notification-service")
  .WithReference(serviceBus)
  .WithReference(notificationSub);
```

**Service Project** (`InventoryService/Program.cs`):

```csharp
var builder = WebApplication.CreateBuilder(args);

// Aspire adds Service Bus connection string via environment variables
builder.AddServiceDefaults();  // Includes Service Bus integration

// Register Azure Service Bus transport
// Connection string injected by Aspire
var connectionString = builder.Configuration.GetConnectionString("messaging")
  ?? throw new InvalidOperationException("Service Bus connection string not found");

builder.Services.AddAzureServiceBusTransport(connectionString);

var app = builder.Build();
app.Run();
```

### Configuration Options

| Property | Default | Description |
|----------|---------|-------------|
| `MaxConcurrentCalls` | 10 | Maximum concurrent message processing calls |
| `MaxAutoLockRenewalDuration` | 5 minutes | Maximum duration for automatic lock renewal |
| `MaxDeliveryAttempts` | 10 | Retry limit before dead-lettering |
| `DefaultSubscriptionName` | "default" | Fallback subscription name if not specified |

### Connection Retry Options {#connection-retry}

The transport includes built-in connection retry with exponential backoff for handling transient connection failures:

| Property | Default | Description |
|----------|---------|-------------|
| `InitialRetryAttempts` | 5 | Initial retry attempts with warning logs |
| `InitialRetryDelay` | 1 second | Delay before first retry |
| `MaxRetryDelay` | 120 seconds | Maximum delay (caps exponential backoff) |
| `BackoffMultiplier` | 2.0 | Multiplier for exponential backoff |
| `RetryIndefinitely` | `true` | Continue retrying after initial attempts |

**Example Configuration**:
```csharp
builder.Services.AddAzureServiceBusTransport(
    connectionString: "Endpoint=sb://...",
    configureOptions: options => {
        // Connection retry settings
        options.InitialRetryAttempts = 10;              // More warnings for slow emulators
        options.InitialRetryDelay = TimeSpan.FromSeconds(2);
        options.MaxRetryDelay = TimeSpan.FromMinutes(2);
        options.BackoffMultiplier = 1.5;
        options.RetryIndefinitely = true;               // Keep trying until success
    }
);
```

**Retry Behavior** (with defaults):
1. Initial attempt → fails
2. Wait 1s → retry 1 (logged as warning)
3. Wait 2s → retry 2 (logged as warning)
4. Wait 4s → retry 3 (logged as warning)
5. Wait 8s → retry 4 (logged as warning)
6. Wait 16s → retry 5 (logged as warning)
7. Continue retrying indefinitely at intervals up to 120s (logged every 10 attempts)

**Key Behaviors**:
- **Initial Phase**: First 5 attempts log warnings for each failure
- **Indefinite Phase**: After initial attempts, continues retrying (logged less frequently)
- **Capped Backoff**: Delay never exceeds `MaxRetryDelay` (default 120s)
- **Graceful Shutdown**: Responds to cancellation token for clean shutdown

**Use Cases**:
- **Emulator Startup**: Azure Service Bus emulator may take 45-60 seconds to become ready
- **Network Glitches**: Temporary network issues during service startup
- **Cold Start**: Azure Service Bus may have cold start delays in serverless scenarios
- **Infrastructure Outage**: Service survives extended outages and reconnects automatically

**Fail Fast** (disable indefinite retry):
```csharp
options.RetryIndefinitely = false;  // Throws after InitialRetryAttempts
```

### Runtime Reconnection {#runtime-reconnection}

Azure Service Bus SDK has built-in retry policies that handle transient failures during runtime. The SDK automatically:

1. **Detects Transient Failures**: Network issues, throttling, service unavailability
2. **Automatic Retries**: Uses exponential backoff with configurable policies
3. **Connection Recovery**: Re-establishes connections transparently

**SDK Retry Policy** (configured in ServiceBusClientOptions):
The Azure SDK's built-in retry policy handles most runtime scenarios. Our connection retry is specifically for **initial connection establishment** when the service might not yet be available (e.g., emulator startup).

**No Manual Reconnection Needed**: The Azure Service Bus SDK handles transient failures automatically. Your application code continues to work transparently after recovery

### Domain Topic Auto-Provisioning {#domain-topic-provisioning}

:::new
When a service declares domain ownership via `OwnDomains()`, Whizbang can automatically provision the corresponding topics at worker startup. This ensures the domain owner (publisher) creates infrastructure that subscribers will use.
:::

**Important**: Topic provisioning requires a connection string with **Manage** permissions. In production environments, topics are often pre-provisioned via infrastructure-as-code, so this step is optional.

**Enable Auto-Provisioning**:
```csharp
// Requires separate call with Manage permissions
services.AddAzureServiceBusTransport(connectionString);
services.AddAzureServiceBusProvisioner(adminConnectionString);

services.AddWhizbang()
    .WithRouting(routing => {
        routing.OwnDomains("myapp.users", "myapp.orders");
    })
    .AddTransportConsumer();

// At startup, these topics are automatically created:
// - myapp.users
// - myapp.orders
```

**Provisioning Behavior**:
- Uses `ServiceBusAdministrationClient.CreateTopicIfNotExistsAsync()`
- Idempotent - safe to call from multiple service instances
- Handles race conditions gracefully (ignores 409 Conflict)
- Skips provisioning if `AddAzureServiceBusProvisioner` is not called

**Why Separate Registration?**

The provisioner is registered separately from the transport because:
1. **Different Permissions**: Transport needs Send/Receive, provisioning needs Manage
2. **Production Patterns**: Topics are typically pre-created via IaC (Terraform, Bicep, ARM)
3. **Security**: Not all environments should have Manage permissions

**Development vs Production**:
```csharp
// Development: Auto-provision for convenience
if (builder.Environment.IsDevelopment()) {
    services.AddAzureServiceBusProvisioner(connectionString);
}

// Production: Topics pre-provisioned via infrastructure-as-code
// No AddAzureServiceBusProvisioner call needed
```

---

## Usage Patterns

### Publishing Messages

```csharp
using Whizbang.Core.Transports;

public class OrderService {
  private readonly ITransport _transport;

  public OrderService(ITransport transport) {
    _transport = transport;
  }

  public async Task CreateOrderAsync(CreateOrder command) {
    // Process order...
    var @event = new OrderCreated(orderId, customerId, total, DateTimeOffset.UtcNow);

    // Create envelope
    var envelope = MessageEnvelope.Create(
      messageId: MessageId.New(),
      correlationId: CorrelationId.New(),
      causationId: null,
      payload: @event,
      currentHop: new MessageHop {
        StreamKey = orderId.ToString(),
        Timestamp = DateTimeOffset.UtcNow
      }
    );

    // Publish to multiple destinations
    var inventoryDest = new TransportDestination(
      Address: "whizbang-events",
      RoutingKey: "inventory-service",
      Metadata: new Dictionary<string, JsonElement> {
        ["Destination"] = JsonSerializer.SerializeToElement("inventory")
      }
    );

    var notificationDest = new TransportDestination(
      Address: "whizbang-events",
      RoutingKey: "notification-service",
      Metadata: new Dictionary<string, JsonElement> {
        ["Destination"] = JsonSerializer.SerializeToElement("notifications")
      }
    );

    await _transport.PublishAsync(envelope, inventoryDest);
    await _transport.PublishAsync(envelope, notificationDest);
  }
}
```

### Subscribing to Messages

```csharp
using Whizbang.Core.Transports;

public class InventoryServiceWorker : BackgroundService {
  private readonly ITransport _transport;
  private readonly IDispatcher _dispatcher;
  private ISubscription? _subscription;

  public InventoryServiceWorker(ITransport transport, IDispatcher dispatcher) {
    _transport = transport;
    _dispatcher = dispatcher;
  }

  protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
    // Initialize transport
    await _transport.InitializeAsync(stoppingToken);

    // Subscribe to messages
    var destination = new TransportDestination(
      Address: "whizbang-events",
      RoutingKey: "inventory-service",
      Metadata: new Dictionary<string, JsonElement> {
        ["DestinationFilter"] = JsonSerializer.SerializeToElement("inventory")
      }
    );

    _subscription = await _transport.SubscribeAsync(
      handler: async (envelope, ct) => {
        // Dispatch message to appropriate receptor
        await _dispatcher.LocalInvokeAsync(envelope.Payload, ct);
      },
      destination: destination,
      cancellationToken: stoppingToken
    );

    // Keep worker running
    await Task.Delay(Timeout.Infinite, stoppingToken);
  }

  public override async Task StopAsync(CancellationToken cancellationToken) {
    if (_subscription != null) {
      await _subscription.DisposeAsync();
    }
    await base.StopAsync(cancellationToken);
  }
}
```

### Correlation Filters (Production)

**Without Aspire** - Manual filter provisioning:

```csharp
// Destination metadata triggers automatic filter provisioning
var destination = new TransportDestination(
  Address: "whizbang-events",
  RoutingKey: "inventory-service",
  Metadata: new Dictionary<string, JsonElement> {
    // DestinationFilter triggers ApplyCorrelationFilterAsync()
    ["DestinationFilter"] = JsonSerializer.SerializeToElement("inventory")
  }
);

// Transport automatically provisions CorrelationFilter:
// - Deletes $Default rule
// - Creates DestinationFilter rule with Destination = "inventory"
var subscription = await transport.SubscribeAsync(handler, destination);
```

**With Aspire** - Automatic filter provisioning:

```csharp
// Aspire handles filter provisioning in AppHost
var subscription = topic.AddSubscription("inventory-service")
  .WithDestinationFilter("inventory");  // Provisioned by Aspire at startup
```

---

## Transport Capabilities

The Azure Service Bus transport declares these capabilities:

```csharp
TransportCapabilities.PublishSubscribe |   // ✅ Pub/sub via topics
TransportCapabilities.Reliable |           // ✅ At-least-once delivery
TransportCapabilities.Ordered              // ✅ FIFO within sessions
```

**Not Supported**:
- ❌ `RequestResponse` - Use Inbox/Outbox with correlation IDs instead
- ❌ `ExactlyOnce` - Requires Inbox pattern for deduplication
- ❌ `Streaming` - Use pub/sub with multiple messages

---

## Serialization (AOT-Compatible)

### JsonContextRegistry Integration

Azure Service Bus transport uses `JsonContextRegistry` for AOT-compatible serialization:

```csharp
// Publishing (serialize envelope)
var envelopeType = envelope.GetType();
var typeInfo = _jsonOptions.GetTypeInfo(envelopeType)
  ?? throw new InvalidOperationException($"No JsonTypeInfo found for {envelopeType.Name}");

var json = JsonSerializer.Serialize(envelope, typeInfo);  // Zero reflection

// Message metadata stores envelope type
message.ApplicationProperties["EnvelopeType"] = envelopeType.AssemblyQualifiedName;
```

**Subscribing (deserialize envelope)**:

```csharp
// Get envelope type from metadata
var envelopeTypeName = message.ApplicationProperties["EnvelopeType"] as string;
var envelopeType = Type.GetType(envelopeTypeName);

// Deserialize using JsonTypeInfo
var typeInfo = _jsonOptions.GetTypeInfo(envelopeType);
var envelope = JsonSerializer.Deserialize(json, typeInfo) as IMessageEnvelope;
```

**Why AOT-compatible?**
- `JsonContextRegistry` pre-generates `JsonTypeInfo` for all message types
- No reflection at runtime - all serialization metadata compiled
- Full Native AOT support

---

## Emulator Support

### Aspire Service Bus Emulator

Whizbang detects the emulator automatically:

```csharp
// Detection logic
_isEmulator = connectionString.Contains("localhost") ||
              connectionString.Contains("127.0.0.1");
```

**Emulator Differences**:

| Feature | Production | Emulator |
|---------|-----------|----------|
| **Admin API** | ✅ Available (port 443) | ❌ Not supported |
| **Connectivity Check** | Via `GetNamespacePropertiesAsync()` | Skipped (client open check) |
| **Filter Provisioning** | Manual via Admin API | Aspire provisions at startup |
| **Initialization** | Full verification | Simplified verification |

**Example**:

```csharp
// AppHost
var serviceBus = builder.AddAzureServiceBus("messaging")
  .RunAsEmulator();  // Starts container with emulator

// Transport detects emulator and skips Admin API calls
var transport = new AzureServiceBusTransport(connectionString, jsonOptions);
await transport.InitializeAsync();  // Skips admin verification for emulator
```

---

## Retry and Error Handling

### Automatic Retry with Abandon

```csharp
try {
  // Invoke handler
  await handler(envelope, ct);

  // Complete on success
  await args.CompleteMessageAsync(message, ct);
} catch (Exception ex) {
  var deliveryCount = message.DeliveryCount;

  if (deliveryCount >= MaxDeliveryAttempts) {
    // Dead-letter after max attempts
    await args.DeadLetterMessageAsync(
      message,
      "MaxDeliveryAttemptsExceeded",
      ex.Message,
      ct
    );
  } else {
    // Abandon to retry (message returns to subscription)
    await args.AbandonMessageAsync(message, ct);
  }
}
```

**Retry Behavior**:
- Message abandoned → returns to subscription queue
- Service Bus applies exponential backoff
- After 10 attempts (default) → dead-lettered

### Dead Letter Queue Monitoring

```csharp
// Monitor DLQ for failed messages
var receiver = client.CreateReceiver(
  "whizbang-events",
  "inventory-service",
  new ServiceBusReceiverOptions {
    SubQueue = SubQueue.DeadLetter
  }
);

await foreach (var message in receiver.ReceiveMessagesAsync()) {
  // Analyze failure reason
  var reason = message.DeadLetterReason;
  var description = message.DeadLetterErrorDescription;

  // Log for investigation
  logger.LogError("DLQ: {Reason} - {Description}", reason, description);
}
```

---

## Lock Renewal

### Automatic Lock Extension

```csharp
var processorOptions = new ServiceBusProcessorOptions {
  MaxConcurrentCalls = 20,
  AutoCompleteMessages = false,  // Manual completion after handler succeeds
  MaxAutoLockRenewalDuration = TimeSpan.FromMinutes(5)  // Auto-renew lock for 5 min
};
```

**How It Works**:
- Handler processes message (may take several minutes)
- Service Bus client automatically renews lock every 30 seconds
- Max renewal duration: 5 minutes (configurable)
- If processing exceeds 5 min → lock expires → message abandoned

**Best Practice**: Set `MaxAutoLockRenewalDuration` to expected max processing time + buffer.

---

## Observability

### OpenTelemetry Integration

Azure Service Bus transport emits OpenTelemetry spans:

```csharp
using var activity = WhizbangActivitySource.Transport.StartActivity("PublishAsync");

activity?.SetTag("transport.type", "AzureServiceBus");
activity?.SetTag("transport.topic", topicName);
activity?.SetTag("transport.subscription", subscriptionName);
activity?.SetTag("transport.emulator", isEmulator);
activity?.SetTag("message.id", envelope.MessageId.Value);
activity?.SetTag("message.correlation_id", correlationId);
```

**Trace Correlation**:
- `MessageId` → Unique message identifier
- `CorrelationId` → Request correlation across services
- `CausationId` → Parent message that caused this message

### Health Checks

```csharp
// Register health check
builder.Services.AddAzureServiceBusHealthChecks();

// Health check endpoint
app.MapHealthChecks("/health");
```

**Health Check Logic**:
```csharp
public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct) {
  if (!_transport.IsInitialized) {
    return HealthCheckResult.Unhealthy("Transport not initialized");
  }

  // Check if client is open
  if (_client.IsClosed) {
    return HealthCheckResult.Unhealthy("ServiceBusClient is closed");
  }

  return HealthCheckResult.Healthy("Azure Service Bus transport is healthy");
}
```

---

## Performance

### Throughput Benchmarks

| Metric | Value | Notes |
|--------|-------|-------|
| **Publish Latency** | ~10-50ms | Network + serialization |
| **Subscribe Latency** | ~20-100ms | Network + deserialization + handler |
| **Max Throughput** | ~10,000 msg/sec | Depends on namespace tier |
| **Serialization** | ~100ns | AOT-compiled JsonTypeInfo |

### Concurrency

```csharp
options.MaxConcurrentCalls = 20;  // Process 20 messages in parallel
```

**Guidelines**:
- **CPU-bound handlers**: Set to CPU core count
- **I/O-bound handlers**: Set to 2-4x CPU core count
- **High throughput**: Increase to 50-100 (monitor memory)

### Batching (Future)

Service Bus supports batch sends (not yet implemented):

```csharp
// TODO: Batch sending for higher throughput
await sender.SendMessagesAsync(batch);  // Send multiple at once
```

---

## Best Practices

### DO ✅

- ✅ **Use Correlation Filters** for multi-tenant routing
- ✅ **Set MaxAutoLockRenewalDuration** to expected processing time + buffer
- ✅ **Monitor Dead Letter Queue** for failed messages
- ✅ **Use Aspire for local development** (emulator + automatic provisioning)
- ✅ **Initialize transport during startup** to fail fast if unreachable
- ✅ **Complete messages manually** after successful handling
- ✅ **Use IDispatcher** in subscription handlers for receptor routing

### DON'T ❌

- ❌ Use for request/response patterns (not supported - use Inbox/Outbox)
- ❌ Forget to abandon messages on transient errors (breaks retry)
- ❌ Dead-letter messages on transient errors (use abandon instead)
- ❌ Hardcode connection strings (use configuration/Aspire)
- ❌ Skip emulator detection (breaks admin API calls)
- ❌ Set MaxConcurrentCalls too high (causes memory pressure)

---

## Troubleshooting

### Problem: Messages Not Reaching Subscriber

**Symptoms**: Publisher succeeds, but subscriber never receives messages.

**Causes**:
1. Correlation filter misconfiguration
2. Subscription doesn't exist
3. Destination property mismatch

**Solution**:

```csharp
// Verify destination property matches filter
var destination = new TransportDestination(
  Address: "whizbang-events",
  RoutingKey: "inventory-service",
  Metadata: new Dictionary<string, JsonElement> {
    ["Destination"] = JsonSerializer.SerializeToElement("inventory")  // Must match filter
  }
);

// Check filter in Azure Portal:
// Service Bus Namespace → Topics → whizbang-events → Subscriptions → inventory-service → Rules
// Expected: DestinationFilter with Destination = "inventory"
```

### Problem: "No JsonTypeInfo found for envelope type"

**Symptoms**: Deserialization fails with missing `JsonTypeInfo` error.

**Cause**: Envelope type not registered in `JsonContextRegistry`.

**Solution**:

```csharp
// Ensure envelope type is registered
// In library: MessageEnvelope<T> should auto-register via MessageJsonContextGenerator

// Verify registration
var jsonOptions = JsonContextRegistry.CreateCombinedOptions();
var typeInfo = jsonOptions.GetTypeInfo(typeof(MessageEnvelope<OrderCreated>));
if (typeInfo == null) {
  // Not registered - check generator output
}
```

### Problem: Transport Initialization Fails

**Symptoms**: `InitializeAsync()` throws `InvalidOperationException`.

**Causes**:
1. Invalid connection string
2. Service Bus namespace unreachable
3. Admin client not available (production)

**Solution**:

```csharp
try {
  await transport.InitializeAsync();
} catch (InvalidOperationException ex) {
  // Check connection string
  logger.LogError(ex, "Invalid connection string or Service Bus unreachable");

  // For emulator: Ensure Aspire AppHost is running
  // For production: Check network connectivity and connection string
}
```

### Problem: Messages Dead-Lettered Immediately

**Symptoms**: All messages go to DLQ without processing.

**Causes**:
1. Handler throws exception
2. Missing envelope type metadata
3. Deserialization failure

**Solution**:

```csharp
// Check DLQ for failure reason
var dlqReceiver = client.CreateReceiver(
  "whizbang-events",
  "inventory-service",
  new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter }
);

await foreach (var message in dlqReceiver.ReceiveMessagesAsync()) {
  logger.LogError(
    "DLQ: {Reason} - {Description}. MessageId={MessageId}",
    message.DeadLetterReason,
    message.DeadLetterErrorDescription,
    message.MessageId
  );

  // Common reasons:
  // - "MissingEnvelopeType" → Publisher didn't set ApplicationProperties["EnvelopeType"]
  // - "UnresolvableEnvelopeType" → Type not found (assembly not loaded)
  // - "DeserializationFailed" → JSON mismatch or missing JsonTypeInfo
  // - "MaxDeliveryAttemptsExceeded" → Handler keeps failing
}
```

---

## Further Reading

**Transports**:
- [In-Memory Transport](in-memory.md) - Local testing and development

**Messaging Patterns**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable cross-service events
- [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once processing
- [Work Coordination](../messaging/work-coordination.md) - Lease-based message processing

**Source Generators**:
- [JSON Contexts](../source-generators/json-contexts.md) - AOT-compatible JSON serialization

**Infrastructure**:
- [Aspire Integration](../infrastructure/aspire-integration.md) - .NET Aspire orchestration
- [Health Checks](../infrastructure/health-checks.md) - Application health monitoring

**Advanced**:
- [Custom Transports](../extensibility/custom-transports.md) - Implementing custom transports

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
