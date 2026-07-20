---
title: Azure Service Bus Transport
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Transports
order: 1
description: >-
  Reliable cross-service messaging with Azure Service Bus topics and
  subscriptions - AOT-compatible with correlation filters
tags: >-
  transports, azure-service-bus, messaging, topics, subscriptions,
  correlation-filters, aspire, aot
codeReferences:
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusTransport.cs
  - src/Whizbang.Transports.AzureServiceBus/ServiceCollectionExtensions.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusOptions.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusConnectionRetry.cs
  - src/Whizbang.Transports.AzureServiceBus/ServiceBusSubscriptionNameHelper.cs
  - src/Whizbang.Transports.AzureServiceBus/IServiceBusAdminClient.cs
  - src/Whizbang.Transports.AzureServiceBus/ServiceBusAdminClientWrapper.cs
  - src/Whizbang.Transports.AzureServiceBus/ServiceBusInfrastructureProvisioner.cs
  - src/Whizbang.Hosting.Azure.ServiceBus/ServiceBusSubscriptionExtensions.cs
testReferences:
  - >-
    tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusConnectionRetryTests.cs
  - >-
    tests/Whizbang.Transports.AzureServiceBus.Tests/ServiceBusSubscriptionNameHelperTests.cs
  - >-
    tests/Whizbang.Transports.AzureServiceBus.Tests/SubscriptionNameDerivationTests.cs
  - >-
    tests/Whizbang.Transports.AzureServiceBus.Tests/ServiceBusInfrastructureProvisionerTests.cs
  - >-
    tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusTransportUnitTests.cs
  - >-
    tests/Whizbang.Transports.AzureServiceBus.Tests/SqlFilterPatternMatchingTests.cs
  - >-
    tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusBatchSubscribeTests.cs
lastMaintainedCommit: '01f07906'
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

```mermaid{caption="Topic/subscription fan-out — the whizbang.events topic delivers to per-service subscriptions, each filtered by the Destination property."}
flowchart TD
    subgraph NS["Azure Service Bus Namespace"]
        subgraph Topic["Topic: #quot;whizbang.events#quot;"]
            Sub1["Subscription: #quot;inventory-service#quot;<br/>Filter: Destination = #quot;inventory#quot;"]
            Sub2["Subscription: #quot;notification-service#quot;<br/>Filter: Destination = #quot;notifications#quot;"]
            Sub3["Subscription: #quot;analytics-service#quot;<br/>Filter: Destination = #quot;analytics#quot;"]
        end
    end

    Svc1["Inventory Service"]
    Svc2["Notification Service"]
    Svc3["Analytics Service"]

    Sub1 --> Svc1
    Sub2 --> Svc2
    Sub3 --> Svc3

    class Sub1,Sub2,Sub3 layer-command
    class Svc1,Svc2,Svc3 layer-core
```

### Message Flow

```mermaid{caption="Message flow — publisher → AzureServiceBusTransport → whizbang.events topic → correlation-filtered subscription → inventory-service subscriber."}
flowchart TD
    Publisher["Publisher (Order Service)"]
    Transport["AzureServiceBusTransport<br/><br/>- Serialize MessageEnvelope<br/>- Set ApplicationProperties:<br/>• MessageId<br/>• CorrelationId<br/>• CausationId<br/>• Destination = #quot;inventory#quot;"]
    Topic["Azure Service Bus Topic<br/>#quot;whizbang.events#quot;"]
    Subscription["Subscription: #quot;inventory-service#quot;<br/>(Only messages with matching<br/>Destination property)"]
    Subscriber["Inventory Service Subscriber<br/><br/>- Deserialize MessageEnvelope<br/>- Extract metadata (IDs, hops)<br/>- Invoke handler<br/>- Complete or Abandon message"]

    Publisher -->|"1. PublishAsync(envelope, destination)<br/>Destination: #quot;inventory#quot;"| Transport
    Transport -->|"2. SendMessageAsync()"| Topic
    Topic -->|"3. Correlation Filter<br/>WHERE Destination = #quot;inventory#quot;"| Subscription
    Subscription -->|"4. ProcessMessageAsync()"| Subscriber

    class Publisher,Transport,Topic,Subscription layer-command
    class Subscriber layer-core
```

---

## Configuration

### 1. Add NuGet Package

```bash{title="Add NuGet Package" description="Add NuGet Package" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Add", "NuGet"]}
dotnet add package Whizbang.Transports.AzureServiceBus
```

### 2. Register Transport (Standard .NET)

```csharp{title="Register Transport (Standard .NET)" description="Register Transport (Standard .NET)" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Register", "Transport"] unverified="configuration — no behavior to assert"}
using Whizbang.Transports.AzureServiceBus;

var builder = WebApplication.CreateBuilder(args);

// Register Azure Service Bus transport
builder.Services.AddAzureServiceBusTransport(
  connectionString: "Endpoint=sb://...",
  configureOptions: options => {
    options.MaxConcurrentCalls = 100;             // Default: 200
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

```csharp{title="Register Transport (.NET Aspire)" description="Register Transport (.NET Aspire)" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Register", "Transport"] unverified="configuration — no behavior to assert"}
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

```csharp{title="Register Transport (.NET Aspire) (2)" description="Service Project (`InventoryService/Program." category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Register", "Transport"] unverified="configuration — no behavior to assert"}
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
| `MaxConcurrentCalls` | 200 | Maximum concurrent message processing calls (non-session processors) |
| `MaxAutoLockRenewalDuration` | 5 minutes | Maximum duration for automatic lock renewal |
| `MaxDeliveryAttempts` | 10 | Retry limit before dead-lettering |
| `DefaultSubscriptionName` | "default" | Fallback subscription name if not specified |
| `AutoProvisionInfrastructure` | `true` | Auto-create topics and subscriptions when subscribing |
| `EnableSessions` | `true` | Session-based FIFO ordering (sets SessionId from StreamId) |
| `MaxConcurrentSessions` | 200 | Maximum concurrent sessions processed per processor (only when EnableSessions is true) |
| `SessionIdleTimeout` | 1 second | How long a session processor waits for the next message before releasing the session |
| `PrefetchCount` | 50 | Messages prefetched per processor |
| `PublishMaxConcurrency` | 200 | Maximum concurrent publish operations |
| `SendTimeout` | 30 seconds | Timeout applied to each send operation |

### Sessions and FIFO Ordering {#sessions}

Azure Service Bus supports strict FIFO message ordering within a **session**. When `EnableSessions` is true (the default):

- Messages with a `StreamId` have their `SessionId` set to the StreamId value
- The `SessionProcessor` delivers messages with the same SessionId in order to a single consumer
- `MaxConcurrentSessions` controls how many different streams are processed in parallel (default: 200)
- `MaxConcurrentCallsPerSession` is always 1 (strict FIFO within each session)
- The transport claims `TransportCapabilities.Ordered` only when sessions are enabled

**Auto-Migration**: When `EnableSessions` is true and an existing subscription does not have `RequiresSession`, the transport automatically deletes and recreates it with sessions enabled. This is necessary because Azure Service Bus does not allow toggling `RequiresSession` on existing subscriptions.

```csharp{title="Enable FIFO Ordering" description="Configure session-based message ordering:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "FIFO", "Sessions"] unverified="configuration — no behavior to assert"}
builder.Services.AddAzureServiceBusTransport(
    connectionString: "Endpoint=sb://...",
    configureOptions: options => {
        options.EnableSessions = true;           // FIFO ordering (default: true)
        options.MaxConcurrentSessions = 128;     // Process up to 128 streams in parallel (default: 200)
    }
);
```

:::note
Messages without a `StreamId` (null) do not set a `SessionId`. When sessions are enabled on a subscription, all messages **must** have a SessionId — messages without one will be rejected. This means enabling sessions is an all-or-nothing decision per topic/subscription.
:::

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
```csharp{title="Connection Retry Options" description="Example Configuration:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Connection", "Retry"] unverified="configuration — no behavior to assert"}
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
```csharp{title="Connection Retry Options (2)" description="Fail Fast (disable indefinite retry):" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Connection", "Retry"] unverified="configuration — no behavior to assert"}
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

### Subscription Name Derivation {#subscription-naming}

:::new
Subscription names are automatically derived from the **SubscriberName** metadata, not from the routing key. This ensures valid subscription names even when using wildcard routing patterns like `#` or `*`.
:::

**How Subscription Names Are Generated**:

```csharp{title="Subscription Name Derivation" description="How Subscription Names Are Generated:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Subscription", "Name"] tests=["ServiceBusSubscriptionNameHelperTests.GenerateSubscriptionNameWithValidNamesReturnsExpectedFormatAsync", "ServiceBusSubscriptionNameHelperTests.GenerateSubscriptionNameWithWildcardSanitizesCorrectlyAsync"]}
// Format: {subscriberName}-{topicName}
// Example: "bff-service" + "jdx.contracts.chat" → "bff-service-jdx.contracts.chat"

var destination = new TransportDestination(
  Address: "jdx.contracts.chat",
  RoutingKey: "#",  // Wildcard pattern - NOT used as subscription name
  Metadata: new Dictionary<string, JsonElement> {
    ["SubscriberName"] = JsonSerializer.SerializeToElement("bff-service")
  }
);

// Subscription created: "bff-service-jdx.contracts.chat"
```

**Name Sanitization**:
- Invalid characters (`#`, `*`, `/`, `\`, `,`) are removed
- Maximum length: 50 characters (truncated if exceeded)
- Fallback to `DefaultSubscriptionName` option if no valid name can be derived

**Why Not Use RoutingKey?**

Routing keys often contain wildcard patterns that are invalid for Azure Service Bus subscription names:

| Pattern | Purpose | Valid Subscription Name? |
|---------|---------|-------------------------|
| `#` | Match all messages | ❌ Invalid character |
| `ns.*` | Single-level wildcard | ❌ Invalid character |
| `ns1.#,ns2.#` | Multiple patterns | ❌ Invalid characters |
| `bff-service` | Explicit subscription | ✅ Valid |

The transport automatically detects wildcard patterns and uses `SubscriberName` metadata instead.

### Auto-Provisioning Infrastructure {#auto-provisioning}

:::new
When `AutoProvisionInfrastructure` is enabled (default: `true`), the transport automatically creates topics AND subscriptions when subscribing. This simplifies development and testing workflows.
:::

**Enable Auto-Provisioning** (default behavior):
```csharp{title="Auto-Provisioning Infrastructure" description="Enable Auto-Provisioning (default behavior):" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Auto-Provisioning", "Infrastructure"] unverified="configuration — no behavior to assert"}
// Auto-provisioning is ON by default
services.AddAzureServiceBusTransport(
  connectionString,
  options => {
    options.AutoProvisionInfrastructure = true;  // Default
  }
);

// Admin client is auto-registered when AutoProvisionInfrastructure = true
// Topics and subscriptions are created automatically during SubscribeAsync
```

**Disable Auto-Provisioning** (production):
```csharp{title="Auto-Provisioning Infrastructure (2)" description="Disable Auto-Provisioning (production):" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Auto-Provisioning", "Infrastructure"] unverified="configuration — no behavior to assert"}
services.AddAzureServiceBusTransport(
  connectionString,
  options => {
    options.AutoProvisionInfrastructure = false;  // Skip auto-creation
  }
);

// Expects topics and subscriptions to exist (pre-provisioned via IaC)
```

**Provisioning Behavior**:
- **Topics**: Created if they don't exist
- **Subscriptions**: Created using derived name from `SubscriberName` metadata
- **Idempotent**: Safe to call from multiple service instances
- **Race Condition Handling**: Ignores 409 Conflict errors
- **Graceful Fallback**: If admin client unavailable, provisioning is skipped

**Configuration Options**:

| Property | Default | Description |
|----------|---------|-------------|
| `AutoProvisionInfrastructure` | `true` | Auto-create topics and subscriptions |
| `DefaultSubscriptionName` | `"default"` | Fallback when SubscriberName not provided |

### Domain Topic Provisioning {#domain-topic-provisioning}

:::new
When a service declares domain ownership via `OwnDomains()`, Whizbang can automatically provision the corresponding topics at worker startup. This ensures the domain owner (publisher) creates infrastructure that subscribers will use.
:::

**Important**: Topic provisioning requires a connection string with **Manage** permissions. In production environments, topics are often pre-provisioned via infrastructure-as-code, so this step is optional.

**Enable Domain Topic Provisioning**:
```csharp{title="Domain Topic Provisioning" description="Enable Domain Topic Provisioning:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Domain", "Topic"] unverified="configuration — no behavior to assert"}
// Requires separate call with Manage permissions (or use AutoProvisionInfrastructure)
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
```csharp{title="Domain Topic Provisioning (2)" description="Development vs Production:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Domain", "Topic"] unverified="configuration — no behavior to assert"}
// Development: Auto-provision for convenience
if (builder.Environment.IsDevelopment()) {
    services.AddAzureServiceBusProvisioner(connectionString);
}

// Production: Topics pre-provisioned via infrastructure-as-code
// No AddAzureServiceBusProvisioner call needed
```

### Publish-Path Auto-Provisioning {#publish-auto-provisioning}

:::new
When `AutoProvisionInfrastructure` is enabled and an admin client is available, the transport automatically creates topics **on first publish** to a new destination. This ensures topics exist before sending, matching RabbitMQ's idempotent exchange declaration behavior.
:::

**How It Works**:
- On first publish to a topic, the transport checks if the topic exists via the Admin API
- If missing, the topic is created automatically (idempotent, handles 409 race conditions)
- Subsequent publishes to the same topic skip the check entirely (cached by sender instance)
- Zero performance overhead after first message per topic

**When This Helps**:
- Event destinations resolved dynamically from type namespaces (e.g., `jdx.contracts.embedding`)
- Topics not covered by `OwnDomains()` startup provisioning
- Development environments where topics may not be pre-created

**Production**: Set `AutoProvisionInfrastructure = false` and pre-provision topics via infrastructure-as-code (Terraform, Bicep, ARM templates).

### Admin Client {#admin-client}

The **Admin Client** (`ServiceBusAdministrationClient`) is used for infrastructure provisioning and management operations on Azure Service Bus namespaces.

**When the Admin Client is Used**:
- Creating topics when `AutoProvisionInfrastructure = true`
- Creating subscriptions during `SubscribeAsync`
- Setting up routing filters (SqlFilter rules)
- Domain topic provisioning (via `AddAzureServiceBusProvisioner`)

**Registration**:

The admin client is automatically registered when auto-provisioning is enabled:

```csharp{title="Admin Client" description="The admin client is automatically registered when auto-provisioning is enabled:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Admin", "Client"] unverified="configuration — no behavior to assert"}
// Auto-provisioning mode (default)
services.AddAzureServiceBusTransport(
  connectionString,
  options => {
    options.AutoProvisionInfrastructure = true;  // Admin client auto-registered
  }
);
```

For domain topic provisioning with separate admin permissions:

```csharp{title="Admin Client (2)" description="For domain topic provisioning with separate admin permissions:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Admin", "Client"] unverified="configuration — no behavior to assert"}
// Separate admin client with Manage permissions
services.AddAzureServiceBusTransport(connectionString);  // Send/Receive permissions
services.AddAzureServiceBusProvisioner(adminConnectionString);  // Manage permissions
```

**Required Permissions**:

The connection string used for the admin client must have **Manage** permissions:

| Operation | Permission Level |
|-----------|-----------------|
| Send/Receive messages | Send, Listen |
| Create topics | Manage |
| Create subscriptions | Manage |
| Create filters | Manage |

**Production Considerations**:

```csharp{title="Admin Client (3)" description="Production Considerations:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Admin", "Client"] unverified="configuration — no behavior to assert"}
// Development: Auto-provision with Manage permissions
if (builder.Environment.IsDevelopment()) {
    services.AddAzureServiceBusTransport(
        connectionString,  // Connection string with Manage permissions
        options => {
            options.AutoProvisionInfrastructure = true;
        }
    );
}

// Production: Pre-provisioned infrastructure via IaC
else {
    services.AddAzureServiceBusTransport(
        connectionString,  // Connection string with only Send/Listen permissions
        options => {
            options.AutoProvisionInfrastructure = false;  // No admin client needed
        }
    );
}
```

**Graceful Fallback**:

If the admin client is unavailable or lacks permissions:
- Provisioning operations are skipped silently
- The transport continues to function using existing infrastructure
- Errors are logged for troubleshooting

This design allows services to run in restricted environments where infrastructure is pre-provisioned via infrastructure-as-code tools like Terraform or Bicep.

### Routing Pattern Filters {#routing-filters}

:::new
When using wildcard routing patterns (e.g., `ns.#` or `ns1.#,ns2.#`), the transport automatically creates **SqlFilter** rules to route messages based on the `Subject` property.
:::

**How Routing Patterns Are Translated**:

| RabbitMQ Pattern | SqlFilter Expression |
|------------------|---------------------|
| `#` | `1=1` (match all) |
| `ns.#` | `[Subject] LIKE 'ns.%'` |
| `ns.*` | `[Subject] LIKE 'ns.%'` |
| `ns1.#,ns2.#` | `[Subject] LIKE 'ns1.%' OR [Subject] LIKE 'ns2.%'` |

**Example with Multiple Patterns**:

```csharp{title="Routing Pattern Filters" description="Example with Multiple Patterns:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Routing", "Pattern"]}
// Subscribe to messages from multiple namespaces
var destination = new TransportDestination(
  Address: "shared.inbox",
  RoutingKey: "inventory.#,orders.#,shipping.#",
  Metadata: new Dictionary<string, JsonElement> {
    ["SubscriberName"] = JsonSerializer.SerializeToElement("fulfillment-service"),
    ["RoutingPatterns"] = JsonSerializer.SerializeToElement(
      new[] { "inventory.#", "orders.#", "shipping.#" }
    )
  }
);

// Creates SqlFilter:
// [Subject] LIKE 'inventory.%' OR [Subject] LIKE 'orders.%' OR [Subject] LIKE 'shipping.%'
```

**Filter Provisioning Behavior**:
- Removes the `$Default` rule (which matches all messages)
- Creates a `RoutingPatternFilter` rule with the SqlFilter expression
- Only applied when `RoutingPatterns` metadata is present
- Requires `AutoProvisionInfrastructure = true` (default)

---

## Usage Patterns

In a Whizbang application you rarely call the transport directly — publishing flows through the **outbox** (`dispatcher.PublishAsync` → outbox → `OutboxDrainWorker` → transport), and subscribing is handled by `TransportConsumerWorker` via `AddTransportConsumer()`. The examples below show the transport-level API those workers use.

### Publishing Messages

```csharp{title="Publishing Messages" description="Transport-level publish (normally driven by the outbox workers)" category="Configuration" difficulty="ADVANCED" tags=["Messaging", "Transports", "Publishing", "Messages"]}
using Whizbang.Core.Transports;

// ITransport.PublishAsync signature:
//   Task PublishAsync(
//     IMessageEnvelope envelope,
//     TransportDestination destination,
//     string? envelopeType = null,
//     ReadOnlyMemory<byte>? preSerializedBytes = null,
//     CancellationToken cancellationToken = default);

var destination = new TransportDestination(
  Address: "whizbang-events",
  RoutingKey: "inventory-service",
  Metadata: new Dictionary<string, JsonElement> {
    // StreamId in metadata → SessionId for FIFO ordering (sessions enabled)
    ["StreamId"] = JsonSerializer.SerializeToElement(streamId.ToString()),
    ["Destination"] = JsonSerializer.SerializeToElement("inventory")
  }
);

// envelope: an IMessageEnvelope produced by the dispatcher/outbox pipeline
await transport.PublishAsync(envelope, destination, cancellationToken: ct);
```

### Subscribing to Messages

The transport exposes **batch** subscription — `TransportConsumerWorker` uses `SubscribeBatchAsync` and feeds batches into the inbox pipeline:

```csharp{title="Subscribing to Messages" description="Transport-level batch subscribe (normally driven by TransportConsumerWorker)" category="Configuration" difficulty="ADVANCED" tags=["Messaging", "Transports", "Subscribing", "Messages"]}
using Whizbang.Core.Transports;

await transport.InitializeAsync(stoppingToken);

var destination = new TransportDestination(
  Address: "whizbang-events",
  RoutingKey: "inventory-service",
  Metadata: new Dictionary<string, JsonElement> {
    ["SubscriberName"] = JsonSerializer.SerializeToElement("inventory-service"),
    ["DestinationFilter"] = JsonSerializer.SerializeToElement("inventory")
  }
);

ISubscription subscription = await transport.SubscribeBatchAsync(
  batchHandler: async (messages, ct) => {
    // TransportConsumerWorker: filter by EnvelopeType header, deserialize,
    // store via StoreInboxMessagesAsync — handlers fire from the inbox pipeline
    foreach (var message in messages) {
      await ProcessTransportMessageAsync(message, ct);
    }
  },
  destination: destination,
  batchOptions: new TransportBatchOptions(),
  cancellationToken: stoppingToken
);

// Dispose the subscription on shutdown (ISubscription : IDisposable)
subscription.Dispose();
```

**Prefer the turnkey path**: `services.AddWhizbang().WithRouting(...).AddTransportConsumer()` wires all of this — subscriptions, resilience, inbox storage, and handler dispatch — automatically. See [Transport Consumer](./transport-consumer.md).

### Correlation Filters (Production)

**Without Aspire** - Manual filter provisioning:

```csharp{title="Correlation Filters (Production)" description="Without Aspire - Manual filter provisioning:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Correlation", "Filters"]}
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

```csharp{title="Correlation Filters (Production) (2)" description="With Aspire - Automatic filter provisioning:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Correlation", "Filters"] unverified="configuration — no behavior to assert"}
// Aspire handles filter provisioning in AppHost
var subscription = topic.AddSubscription("inventory-service")
  .WithDestinationFilter("inventory");  // Provisioned by Aspire at startup
```

---

## Transport Capabilities

The Azure Service Bus transport declares these capabilities:

```csharp{title="Transport Capabilities" description="The Azure Service Bus transport declares these capabilities:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Transport", "Capabilities"]}
TransportCapabilities.PublishSubscribe |   // ✅ Pub/sub via topics
TransportCapabilities.Reliable |           // ✅ At-least-once delivery
TransportCapabilities.BulkPublish |        // ✅ Batched sends
(EnableSessions ? TransportCapabilities.Ordered : None)  // ✅ FIFO within sessions
```

**Not Supported**:
- ❌ `RequestResponse` - Use Inbox/Outbox with correlation IDs instead
- ❌ `ExactlyOnce` - Requires Inbox pattern for deduplication
- ❌ `Streaming` - Use pub/sub with multiple messages

---

## Serialization (AOT-Compatible)

### JsonContextRegistry Integration

Azure Service Bus transport uses `JsonContextRegistry` for AOT-compatible serialization:

```csharp{title="JsonContextRegistry Integration" description="Azure Service Bus transport uses JsonContextRegistry for AOT-compatible serialization:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "JsonContextRegistry", "Integration"]}
// Publishing (serialize envelope)
var envelopeType = envelope.GetType();
var typeInfo = _jsonOptions.GetTypeInfo(envelopeType)
  ?? throw new InvalidOperationException($"No JsonTypeInfo found for {envelopeType.Name}");

var json = JsonSerializer.Serialize(envelope, typeInfo);  // Zero reflection

// Message metadata stores envelope type
message.ApplicationProperties["EnvelopeType"] = envelopeType.AssemblyQualifiedName;
```

**Subscribing (deserialize envelope)**:

```csharp{title="JsonContextRegistry Integration (2)" description="Subscribing (deserialize envelope):" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "JsonContextRegistry", "Integration"]}
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

```csharp{title="Aspire Service Bus Emulator" description="Whizbang detects the emulator automatically:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Aspire", "Service"]}
// Detection logic (from the connection string's endpoint)
_isEmulator = endpoint.Contains("localhost", StringComparison.OrdinalIgnoreCase) ||
              endpoint.Contains("127.0.0.1");
```

**Emulator Differences**:

| Feature | Production | Emulator |
|---------|-----------|----------|
| **Admin API** | ✅ Available (port 443) | ❌ Not supported |
| **Connectivity Check** | Via `GetNamespacePropertiesAsync()` | Skipped (client open check) |
| **Filter Provisioning** | Manual via Admin API | Aspire provisions at startup |
| **Initialization** | Full verification | Simplified verification |

**Example**:

```csharp{title="Aspire Service Bus Emulator (2)" description="Aspire Service Bus Emulator" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Aspire", "Service"]}
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

```csharp{title="Automatic Retry with Abandon" description="Automatic Retry with Abandon" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Automatic", "Retry"]}
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

```csharp{title="Dead Letter Queue Monitoring" description="Dead Letter Queue Monitoring" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Dead", "Letter"] unverified="raw Azure Service Bus SDK — not a Whizbang API"}
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

```csharp{title="Automatic Lock Extension" description="Automatic Lock Extension" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Automatic", "Lock"] unverified="raw Azure Service Bus SDK options — not a Whizbang API"}
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

```csharp{title="OpenTelemetry Integration" description="Azure Service Bus transport emits OpenTelemetry spans:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "OpenTelemetry", "Integration"]}
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

```csharp{title="Health Checks" description="Health Checks" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Health", "Checks"] unverified="configuration — no behavior to assert"}
// Register health check
builder.Services.AddAzureServiceBusHealthChecks();

// Health check endpoint
app.MapHealthChecks("/health");
```

**Health Check Logic**:
```csharp{title="Health Checks (2)" description="Health Check Logic:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Health", "Checks"]}
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

```csharp{title="Concurrency" description="Concurrency" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Concurrency"] unverified="configuration — no behavior to assert"}
options.MaxConcurrentCalls = 20;  // Process 20 messages in parallel
```

**Guidelines**:
- **CPU-bound handlers**: Set to CPU core count
- **I/O-bound handlers**: Set to 2-4x CPU core count
- **High throughput**: Increase to 50-100 (monitor memory)

### Batching

The transport implements bulk publish (`TransportCapabilities.BulkPublish`): messages destined for the same topic are packed into `ServiceBusMessageBatch` chunks and sent with one network call per batch:

```csharp{title="Batching" description="Bulk publish packs messages into ServiceBusMessageBatch chunks" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Batching", "Future"]}
// Inside the bulk publish path (simplified):
var currentBatch = await sender.CreateMessageBatchAsync(ct);
// ... TryAddMessage until full, then:
await sender.SendMessagesAsync(batch, cancellationToken);  // One call, many messages
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

### Problem: "MessagingEntityNotFound" on Publish

**Symptoms**: Publishing fails with `MessagingEntityNotFound` for a topic (e.g., `jdx.contracts.embedding`).

**Cause**: The destination topic doesn't exist and auto-provisioning is disabled or no admin client is available.

**Solution**:
1. Enable auto-provisioning: `options.AutoProvisionInfrastructure = true` (default) — topics are created on first publish
2. Or declare the domain via `OwnDomains()` for startup provisioning
3. Or pre-create the topic via infrastructure-as-code (Terraform, Bicep)

```csharp{title="Problem: 'MessagingEntityNotFound' on Publish" description="Solution: 1." category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Problem:", "'MessagingEntityNotFound'"] unverified="configuration — no behavior to assert"}
// Option 1: Auto-provisioning (default, creates topics on first publish)
services.AddAzureServiceBusTransport(connectionString, options => {
    options.AutoProvisionInfrastructure = true;  // Default
});

// Option 2: Startup provisioning via OwnDomains
services.AddWhizbang()
    .WithRouting(routing => {
        routing.OwnDomains("jdx.contracts.embedding", "jdx.contracts.search");
    });
```

### Problem: Messages Not Reaching Subscriber

**Symptoms**: Publisher succeeds, but subscriber never receives messages.

**Causes**:
1. Correlation filter misconfiguration
2. Subscription doesn't exist
3. Destination property mismatch

**Solution**:

```csharp{title="Problem: Messages Not Reaching Subscriber" description="Problem: Messages Not Reaching Subscriber" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Problem:", "Messages"]}
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

```csharp{title="Problem: 'No JsonTypeInfo found for envelope type'" description="Problem: 'No JsonTypeInfo found for envelope type'" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Problem:", "'No"] unverified="JsonContextRegistry API — verified in the JSON Contexts docs, not the transport tests"}
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

```csharp{title="Problem: Transport Initialization Fails" description="Problem: Transport Initialization Fails" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Problem:", "Transport"]}
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

```csharp{title="Problem: Messages Dead-Lettered Immediately" description="Problem: Messages Dead-Lettered Immediately" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Problem:", "Messages"] unverified="raw Azure Service Bus SDK — not a Whizbang API"}
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
  // - "MissingJsonTypeInfo" → Envelope type not registered in JsonContextRegistry
  // - "DeserializationFailed" → JSON mismatch
  // - "MaxDeliveryAttemptsExceeded" → Handler keeps failing
}
```

---

## Further Reading

**Transports**:
- [In-Memory Transport](in-memory.md) - Local testing and development

**Messaging Patterns**:
- [Outbox Pattern](../outbox-pattern.md) - Reliable cross-service events
- [Inbox Pattern](../inbox-pattern.md) - Exactly-once processing
- [Work Coordination](../work-coordination.md) - Lease-based message processing

**Source Generators**:
- [JSON Contexts](../../extending/source-generators/json-contexts.md) - AOT-compatible JSON serialization

**Infrastructure**:
- [Aspire Integration](../../operations/infrastructure/aspire-integration.md) - .NET Aspire orchestration
- [Health Checks](../../operations/infrastructure/health-checks.md) - Application health monitoring

**Advanced**:
- [Custom Transports](../../extending/extensibility/custom-transports.md) - Implementing custom transports

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-03-02*
