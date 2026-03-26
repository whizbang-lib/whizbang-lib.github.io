---
title: RabbitMQ Transport
version: 1.0.0
category: Transports
order: 2
description: >-
  Distributed event-driven messaging with RabbitMQ topic exchanges -
  AOT-compatible with channel pooling and dead-letter queue support
tags: >-
  transports, rabbitmq, messaging, topic-exchange, dead-letter-queue,
  channel-pool, aot, testcontainers
codeReferences:
  - src/Whizbang.Transports.RabbitMQ/RabbitMQTransport.cs
  - src/Whizbang.Transports.RabbitMQ/ServiceCollectionExtensions.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMQOptions.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMQChannelPool.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMQConnectionRetry.cs
testReferences:
  - tests/Whizbang.Transports.RabbitMQ.Tests/RabbitMQTransportTests.cs
  - tests/Whizbang.Transports.RabbitMQ.Tests/RabbitMQChannelPoolTests.cs
  - tests/Whizbang.Transports.RabbitMQ.Tests/RabbitMQConnectionRetryTests.cs
  - samples/ECommerce/tests/ECommerce.RabbitMQ.Integration.Tests/
lastMaintainedCommit: '01f07906'
---

# RabbitMQ Transport

The **RabbitMQ transport** provides reliable, distributed messaging using RabbitMQ topic exchanges with automatic dead-letter queue handling, connection pooling, and full AOT compatibility. This enables pub/sub patterns for event-driven architectures with flexible routing and retry semantics.

## Why RabbitMQ?

**RabbitMQ** is a battle-tested open-source message broker offering:

| Feature | Description | Benefit |
|---------|-------------|---------|
| **Topic Exchanges** | Flexible routing patterns | Wildcard subscriptions (`product.*`) |
| **At-Least-Once Delivery** | Message acknowledgments | Reliability |
| **Dead Letter Queues** | Automatic failure handling | Observability & recovery |
| **Lightweight** | Runs on-premise or containers | Developer-friendly |
| **Message TTL** | Time-to-live support | Automatic cleanup |
| **Prefetch Control** | QoS flow control | Backpressure management |

**Whizbang Integration**:
- ✅ **AOT-Compatible** - Uses `JsonContextRegistry` for source-generated JSON serialization
- ✅ **Channel Pooling** - Thread-safe operations via semaphore-based pooling
- ✅ **TestContainers Support** - First-class integration testing with Docker
- ✅ **Dead-Letter Queues** - Automatic DLX/DLQ creation and binding
- ✅ **Pause/Resume** - Subscription lifecycle management
- ✅ **Correlation Tracing** - MessageId, CorrelationId, CausationId propagation

---

## Architecture

### Topic Exchange Pattern

```
┌────────────────────────────────────────────────────────┐
│  RabbitMQ Broker                                       │
│                                                         │
│  ┌────────────────────────────────────────────────┐   │
│  │  Exchange: "products" (topic)                  │   │
│  │                                                 │   │
│  │  ┌──────────────────────────────────────────┐ │   │
│  │  │  Queue: "inventory-products-queue"       │ │   │
│  │  │  Binding: "product.*"                    │ │   │
│  │  │  → Inventory Service                     │ │   │
│  │  └──────────────────────────────────────────┘ │   │
│  │                                                 │   │
│  │  ┌──────────────────────────────────────────┐ │   │
│  │  │  Queue: "analytics-products-queue"       │ │   │
│  │  │  Binding: "product.created"              │ │   │
│  │  │  → Analytics Service                     │ │   │
│  │  └──────────────────────────────────────────┘ │   │
│  │                                                 │   │
│  │  ┌──────────────────────────────────────────┐ │   │
│  │  │  Queue: "notifications-queue"            │ │   │
│  │  │  Binding: "#" (all messages)             │ │   │
│  │  │  → Notification Service                  │ │   │
│  │  └──────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────┘   │
│                                                         │
│  ┌────────────────────────────────────────────────┐   │
│  │  Dead Letter Exchange: "products.dlx" (fanout) │   │
│  │                                                 │   │
│  │  ┌──────────────────────────────────────────┐ │   │
│  │  │  Dead Letter Queue: "inventory-queue.dlq"│ │   │
│  │  └──────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

### Channel Pool Architecture

RabbitMQ channels are **not thread-safe**, so Whizbang uses a channel pool for concurrent publishing:

```
┌───────────────────────────────────────────┐
│  RabbitMQChannelPool                      │
│                                           │
│  ┌─────────────────────────────────────┐ │
│  │  Available Channels (Semaphore)     │ │
│  │  Max: 10 (configurable)             │ │
│  │                                      │ │
│  │  ┌──────┐ ┌──────┐ ┌──────┐        │ │
│  │  │ CH 1 │ │ CH 2 │ │ CH 3 │  ...   │ │
│  │  └──────┘ └──────┘ └──────┘        │ │
│  └─────────────────────────────────────┘ │
└───────────────────────────────────────────┘
         ▲                  │
         │ Rent             │ Return
         │                  ▼
┌─────────────────────────────────────────┐
│  Publisher (TransportPublishStrategy)   │
│                                          │
│  using (var channel =                   │
│      await pool.RentChannelAsync()) {   │
│    // Publish message                   │
│    // Channel auto-returns on dispose   │
│  }                                       │
└─────────────────────────────────────────┘
```

**Subscriptions** get dedicated channels (no pooling) for long-lived operations.

### Message Flow

#### Publishing

```
Publisher (Order Service)
  │
  │ 1. PublishAsync(envelope, destination)
  │    Destination.Address: "orders"
  │    Destination.RoutingKey: "order.created"
  ▼
┌─────────────────────────────────────┐
│  RabbitMQTransport                  │
│                                     │
│  - Rent channel from pool           │
│  - Declare exchange (idempotent)    │
│  - Serialize MessageEnvelope        │
│  - Set BasicProperties:             │
│    • MessageId                      │
│    • CorrelationId                  │
│    • EnvelopeType (for deser)       │
│  - BasicPublish(exchange, key)      │
│  - Return channel to pool           │
└─────────────────────────────────────┘
  │
  │ 2. BasicPublish()
  ▼
┌─────────────────────────────────────┐
│  RabbitMQ Exchange: "orders"        │
│  Type: topic                        │
└─────────────────────────────────────┘
  │
  │ 3. Route by pattern
  │    Routing Key: "order.created"
  ▼
┌─────────────────────────────────────┐
│  Queue: "fulfillment-orders-queue"  │
│  Binding: "order.*"                 │
└─────────────────────────────────────┘
```

#### Subscribing

```
Subscriber (Fulfillment Service)
  │
  │ 1. SubscribeAsync(handler, destination)
  │    Destination.Address: "orders"
  │    Destination.RoutingKey: "fulfillment-orders-queue"
  ▼
┌─────────────────────────────────────┐
│  RabbitMQTransport                  │
│                                     │
│  - Create dedicated channel         │
│  - Set QoS prefetch (default: 10)  │
│  - Declare exchange                 │
│  - Declare queue with DLX           │
│  - Bind queue to exchange           │
│  - Create AsyncEventingBasicConsumer│
└─────────────────────────────────────┘
  │
  │ 2. Receive BasicDeliver event
  ▼
┌─────────────────────────────────────┐
│  Message Handler                    │
│                                     │
│  - Check subscription.IsActive      │
│  - Deserialize via EnvelopeType     │
│  - Invoke handler (Receptor)        │
│  - BasicAck on success              │
│  - BasicNack + requeue on failure   │
│  - BasicNack → DLQ after max retries│
└─────────────────────────────────────┘
```

---

## Installation

### Package Reference

**NuGet Package**: `Whizbang.Transports.RabbitMQ` (when published)

```xml{title="Package Reference" description="NuGet Package: `Whizbang." category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Package", "Reference"]}
<PackageReference Include="Whizbang.Transports.RabbitMQ" Version="0.1.0" />
```

### Dependencies

```xml{title="Dependencies" description="Dependencies" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Dependencies"]}
<ItemGroup>
  <PackageReference Include="RabbitMQ.Client" Version="7.1.2" />
  <PackageReference Include="Microsoft.Extensions.DependencyInjection.Abstractions" Version="10.0.1" />
  <PackageReference Include="Microsoft.Extensions.Diagnostics.HealthChecks" Version="10.0.1" />
</ItemGroup>
```

---

## Running the Example Project

The **ECommerce sample** demonstrates cross-service event distribution using **Aspire orchestration** with switchable transport providers. The same application code runs with either **RabbitMQ** or **Azure Service Bus** using compiler directives.

### Architecture Overview

The sample includes:
- **OrderService.API**: Handles order commands and workflows
- **InventoryWorker**: Manages inventory and publishes stock events
- **PaymentWorker**: Processes payment transactions
- **ShippingWorker**: Handles fulfillment and shipping
- **NotificationWorker**: Sends customer notifications
- **BFF.API**: Aggregates cross-service data via perspectives (GraphQL + REST)
- **ECommerce.UI**: Angular frontend (port 4200)

**Cross-Service Event Flow**:
```
OrderService → "orders" topic → [Payment, Shipping, Inventory, Notification, BFF]
InventoryWorker → "products" topic → [BFF, InventoryWorker]
PaymentWorker → "payments" topic → [BFF]
ShippingWorker → "shipping" topic → [BFF]
```

### Transport Provider Selection

The ECommerce sample uses **compiler directives** to switch between transports at build time:

```xml{title="Transport Provider Selection" description="The ECommerce sample uses compiler directives to switch between transports at build time:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Transport", "Provider"]}
<!-- Directory.Build.props -->
<DefineConstants Condition="'$(TransportProvider)' == ''">AZURESERVICEBUS</DefineConstants>
<DefineConstants Condition="'$(TransportProvider)' == 'RabbitMQ'">RABBITMQ</DefineConstants>
<DefineConstants Condition="'$(TransportProvider)' == 'AzureServiceBus'">AZURESERVICEBUS</DefineConstants>
```

**Default**: Azure Service Bus
**Switch to RabbitMQ**: Add `/p:TransportProvider=RabbitMQ` to build/run commands

### Prerequisites

**Required Tools**:
- **.NET 10 SDK** (or later)
- **Docker Desktop** (for emulators)
- **Node.js 20+** (for Angular UI)
- **.NET Aspire Workload**: `dotnet workload install aspire`

**Verify Installation**:
```bash{title="Prerequisites" description="Verify Installation:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Prerequisites"]}
dotnet --version  # Should be 10.0.1 or later
docker --version  # Should be 20.10 or later
node --version    # Should be 20.0 or later
dotnet workload list | grep aspire  # Should show aspire workload
```

---

### Running with RabbitMQ

**1. Build with RabbitMQ Transport**:
```bash{title="Running with RabbitMQ" description="Running with RabbitMQ" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Running", "RabbitMQ"]}
cd samples/ECommerce

# Build all projects with RabbitMQ transport
dotnet build /p:TransportProvider=RabbitMQ
```

**2. Start Aspire AppHost**:
```bash{title="Running with RabbitMQ" description="Running with RabbitMQ" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Running", "RabbitMQ"]}
cd ECommerce.AppHost

# Run with RabbitMQ (Aspire dashboard at https://localhost:17036)
dotnet run /p:TransportProvider=RabbitMQ
```

**What Aspire Does**:
- ✅ Starts **RabbitMQ container** (port 5672, management UI at 15672)
- ✅ Starts **PostgreSQL container** (port 5432, pgAdmin at 5050)
- ✅ Creates **exchanges** (`orders`, `products`, `payments`, `shipping`, `inbox`)
- ✅ Creates **queue bindings** with routing patterns
- ✅ Initializes **7 microservices** with dependency injection
- ✅ Starts **Angular UI** at http://localhost:4200
- ✅ Provides **Aspire Dashboard** for observability

**3. Access Services**:
```bash{title="Running with RabbitMQ" description="Running with RabbitMQ" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Running", "RabbitMQ"]}
# Aspire Dashboard
https://localhost:17036

# RabbitMQ Management UI (guest/guest)
http://localhost:15672

# PostgreSQL pgAdmin (admin@admin.com/admin)
http://localhost:5050

# Angular UI
http://localhost:4200

# BFF Swagger UI
http://localhost:<bff-port>/swagger

# BFF GraphQL Playground
http://localhost:<bff-port>/graphql
```

**4. View RabbitMQ Topology**:
- Navigate to **Exchanges** tab → See `orders`, `products`, `payments`, `shipping`, `inbox`
- Navigate to **Queues** tab → See all service queues with bindings
- Navigate to **Connections** tab → See all microservice connections

**5. Stop All Services**:
```bash{title="Running with RabbitMQ" description="Running with RabbitMQ" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Running", "RabbitMQ"]}
# Ctrl+C in terminal running AppHost
# Containers persist by default (ContainerLifetime.Persistent)

# To clean up containers:
docker stop rabbitmq postgres pgadmin
docker rm rabbitmq postgres pgadmin
```

---

### Running with Azure Service Bus Emulator

**1. Build with Azure Service Bus Transport**:
```bash{title="Running with Azure Service Bus Emulator" description="Running with Azure Service Bus Emulator" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Running", "Azure"]}
cd samples/ECommerce

# Build with Azure Service Bus (default)
dotnet build

# Or explicitly:
dotnet build /p:TransportProvider=AzureServiceBus
```

**2. Start Aspire AppHost**:
```bash{title="Running with Azure Service Bus Emulator" description="Running with Azure Service Bus Emulator" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Running", "Azure"]}
cd ECommerce.AppHost

# Run with Azure Service Bus (Aspire dashboard at https://localhost:17036)
dotnet run
```

**What Aspire Does**:
- ✅ Starts **Azure Service Bus Emulator** (port 5672)
- ✅ Creates **topics** (`orders`, `products`, `payments`, `shipping`, `inbox`)
- ✅ Creates **subscriptions** with correlation filters
- ✅ Starts **PostgreSQL container** (port 5432, pgAdmin at 5050)
- ✅ Initializes **7 microservices** with dependency injection
- ✅ Starts **Angular UI** at http://localhost:4200
- ✅ Provides **Aspire Dashboard** for observability

**3. Access Services** (same as RabbitMQ except no Management UI):
```bash{title="Running with Azure Service Bus Emulator" description="Running with Azure Service Bus Emulator" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Running", "Azure"]}
# Aspire Dashboard
https://localhost:17036

# PostgreSQL pgAdmin (admin@admin.com/admin)
http://localhost:5050

# Angular UI
http://localhost:4200

# BFF Swagger UI
http://localhost:<bff-port>/swagger

# BFF GraphQL Playground
http://localhost:<bff-port>/graphql
```

**Note**: Azure Service Bus Emulator has **no management UI**. Use Aspire Dashboard to monitor service health.

---

### Running Integration Tests

The ECommerce sample includes **dedicated integration test projects** for each transport:
- `ECommerce.Integration.Tests` → Azure Service Bus (48 lifecycle tests)
- `ECommerce.RabbitMQ.Integration.Tests` → RabbitMQ (48 lifecycle tests)

**Why Separate Test Projects?**:
- Different fixtures for emulator management (shared vs per-test containers)
- Different topic/exchange isolation strategies
- Different cleanup and drain logic

#### RabbitMQ Integration Tests

**1. Start RabbitMQ Container**:
```bash{title="RabbitMQ Integration Tests" description="RabbitMQ Integration Tests" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "RabbitMQ", "Integration"]}
docker run -d \
  --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:4-management
```

**2. Run Tests**:
```bash{title="RabbitMQ Integration Tests (2)" description="RabbitMQ Integration Tests" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "RabbitMQ", "Integration"]}
cd samples/ECommerce/tests/ECommerce.RabbitMQ.Integration.Tests

# Run all 48 lifecycle tests (sequential execution)
dotnet test

# Run specific test
dotnet run -- --treenode-filter "/*/*/*/RestockInventory_FromZeroStock_IncreasesCorrectlyAsync"
```

**Test Duration**: ~1.5-2 minutes (48 tests, ~1-2s each)

**What Tests Validate**:
- Cross-service event publication (InventoryWorker → RabbitMQ → BFF)
- Topic exchange routing with test-specific exchanges
- Dead letter queue handling (automatic DLX/DLQ creation)
- Perspective materialization from cross-service events
- Channel pool thread-safety under concurrent load
- Subscription pause/resume lifecycle

#### Azure Service Bus Integration Tests

**1. Start Service Bus Emulator**:
```bash{title="Azure Service Bus Integration Tests" description="Azure Service Bus Integration Tests" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Azure", "Service"]}
docker run -d \
  --name servicebus-emulator \
  -p 5672:5672 \
  -v $(pwd)/samples/ECommerce/tests/ECommerce.Integration.Tests/Config-Named.json:/ServiceBus_Emulator/ConfigFiles/Config.json \
  mcr.microsoft.com/azure-messaging/servicebus-emulator:latest
```

**2. Run Tests**:
```bash{title="Azure Service Bus Integration Tests (2)" description="Azure Service Bus Integration Tests" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Azure", "Service"]}
cd samples/ECommerce/tests/ECommerce.Integration.Tests

# Run all 48 lifecycle tests (sequential execution)
dotnet test

# Run specific test
dotnet run -- --treenode-filter "/*/*/*/SeedProducts_CreatesProducts_AndPerspectivesCompleteAsync"
```

**Test Duration**: ~2-2.5 minutes (emulator startup adds 45-60 seconds on first run)

---

### Key Differences Between Transports

| Aspect | RabbitMQ | Azure Service Bus |
|--------|----------|-------------------|
| **AppHost Setup** | `AddRabbitMQ()` with exchanges/queues | `AddAzureServiceBus()` with topics/subscriptions |
| **Topic Creation** | Dynamic (created on first publish) | Static (pre-defined via Aspire or Config.json) |
| **Management UI** | ✅ Built-in (port 15672) | ❌ No UI (use Aspire Dashboard) |
| **Routing** | Wildcard patterns (`product.*`, `#`) | Subscription filters (CorrelationId, MessageId) |
| **DLQ Handling** | Automatic DLX/DLQ creation | Requires explicit subscription configuration |
| **Startup Time** | ~10 seconds | ~45-60 seconds (emulator initialization) |
| **Test Isolation** | Test-specific exchanges (`inventory-{testId}`) | Shared topics (`topic-00`, `topic-01`) |

---

### Troubleshooting

#### AppHost won't start

```bash{title="AppHost won't start" description="AppHost won't start" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "AppHost", "Won't"]}
# Ensure Aspire workload is installed
dotnet workload install aspire

# Check Docker is running
docker ps

# Rebuild all projects
cd samples/ECommerce
dotnet clean
dotnet build /p:TransportProvider=RabbitMQ  # or AzureServiceBus
```

#### RabbitMQ container fails to start

```bash{title="RabbitMQ container fails to start" description="RabbitMQ container fails to start" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "RabbitMQ", "Container"]}
# Check port conflicts
lsof -i :5672
lsof -i :15672

# Remove existing container
docker stop rabbitmq
docker rm rabbitmq

# Start fresh
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4-management
```

#### Azure Service Bus Emulator not ready

```bash{title="Azure Service Bus Emulator not ready" description="Azure Service Bus Emulator not ready" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Azure", "Service"]}
# Check emulator logs
docker logs servicebus-emulator

# Wait for "Emulator is ready" message (can take 60 seconds)
```

#### Integration tests timeout

```bash{title="Integration tests timeout" description="Integration tests timeout" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Integration", "Tests"]}
# Ensure emulator is running
docker ps | grep rabbitmq  # or servicebus-emulator

# Check emulator logs
docker logs rabbitmq

# Restart emulator if needed
docker restart rabbitmq
```

#### Wrong transport used at runtime

```bash{title="Wrong transport used at runtime" description="Wrong transport used at runtime" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Wrong", "Transport"]}
# Verify build used correct transport
cd samples/ECommerce
dotnet clean
dotnet build /p:TransportProvider=RabbitMQ  # or AzureServiceBus

# Check generated symbols in .whizbang-generated folder
grep -r "RABBITMQ\|AZURESERVICEBUS" ECommerce.InventoryWorker/.whizbang-generated
```

---

## Configuration

### Basic Setup

```csharp{title="Basic Setup" description="Basic Setup" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Basic", "Setup"]}
using Whizbang.Transports.RabbitMQ;

var builder = WebApplication.CreateBuilder(args);

// Register RabbitMQ transport
builder.Services.AddRabbitMQTransport(
    connectionString: "amqp://guest:guest@localhost:5672/",
    configureOptions: options => {
        options.MaxChannels = 20;                      // Channel pool size
        options.MaxDeliveryAttempts = 5;               // Retry limit before DLQ
        options.PrefetchCount = 10;                    // QoS prefetch count
        options.AutoDeclareDeadLetterExchange = true;  // Auto-create DLX/DLQ
    }
);

// Add health checks
builder.Services.AddRabbitMQHealthChecks();

var app = builder.Build();

// Health check endpoint
app.MapHealthChecks("/health");

app.Run();
```

### Configuration Options

| Property | Default | Description |
|----------|---------|-------------|
| `MaxChannels` | 10 | Maximum pooled channels for publishing |
| `MaxDeliveryAttempts` | 10 | Retry limit before dead-lettering |
| `DefaultQueueName` | `null` | Fallback queue name if not specified |
| `PrefetchCount` | 10 | QoS prefetch count per consumer |
| `AutoDeclareDeadLetterExchange` | `true` | Auto-create DLX and DLQ |

### Domain Topic Auto-Provisioning {#auto-provisioning}

:::new
When you declare domain ownership via `OwnDomains()`, Whizbang automatically provisions topic exchanges at worker startup.
:::

The `RabbitMQInfrastructureProvisioner` is automatically registered and creates topic exchanges for owned domains:

```csharp{title="Domain Topic Auto-Provisioning" description="The RabbitMQInfrastructureProvisioner is automatically registered and creates topic exchanges for owned domains:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Domain", "Topic"]}
services.AddWhizbang()
    .WithRouting(routing => {
        routing.OwnDomains("myapp.users", "myapp.orders");
    })
    .AddTransportConsumer();

// At startup, these exchanges are auto-created:
// - myapp.users (type: topic, durable: true)
// - myapp.orders (type: topic, durable: true)
```

**Key behaviors:**
- Exchange names are lowercased for consistency
- Exchange declaration is idempotent (safe if already exists)
- Provisioning happens before subscriptions are created
- Multiple service instances can provision concurrently (race-safe)

📖 See [Domain Topic Provisioning](../../fundamentals/dispatcher/routing.md#domain-topic-provisioning) for full details.

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
```csharp{title="Connection Retry Options" description="Example Configuration:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Connection", "Retry"]}
builder.Services.AddRabbitMQTransport(
    connectionString: "amqp://guest:guest@localhost:5672/",
    configureOptions: options => {
        // Connection retry settings
        options.InitialRetryAttempts = 10;              // More warnings for slow containers
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
- **Container Startup**: RabbitMQ container may take 10-30 seconds to become ready
- **Network Glitches**: Temporary network issues during service startup
- **Cluster Failover**: RabbitMQ cluster switching to different node
- **Infrastructure Outage**: Service survives extended outages and reconnects automatically

**Fail Fast** (disable indefinite retry):
```csharp{title="Connection Retry Options (2)" description="Fail Fast (disable indefinite retry):" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Connection", "Retry"]}
options.RetryIndefinitely = false;  // Throws after InitialRetryAttempts
```

### Runtime Reconnection {#runtime-reconnection}

RabbitMQ transport uses the RabbitMQ client's built-in **Automatic Recovery** feature for runtime reconnection. When a connection is lost during operation:

1. **Automatic Detection**: Connection shutdown is detected immediately
2. **Automatic Recovery**: Client attempts to reconnect automatically
3. **Channel Recovery**: All channels and consumers are automatically re-established
4. **Topology Recovery**: Exchanges, queues, and bindings are automatically re-declared

**Connection State Monitoring**:
The transport logs connection state changes for observability:
- `ConnectionShutdown` → Warning with reason code and message
- `RecoverySucceeded` → Information that connection recovered
- `ConnectionRecoveryError` → Error with exception details
- `ConnectionBlocked` → Warning when broker blocks the connection (resource alarm)
- `ConnectionUnblocked` → Information when normal operation resumes

**Configuration**:
```csharp{title="Runtime Reconnection" description="Configuration:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Runtime", "Reconnection"]}
// NetworkRecoveryInterval is set to match InitialRetryDelay
options.InitialRetryDelay = TimeSpan.FromSeconds(5);  // Recovery interval = 5s
```

**No Manual Reconnection Needed**: The RabbitMQ client handles all reconnection automatically. Your application code continues to work transparently after recovery

### Connection String Format

```
amqp://username:password@hostname:port/virtualhost
amqps://username:password@hostname:port/virtualhost  # TLS
```

**Examples**:
- Local development: `amqp://guest:guest@localhost:5672/`
- Production: `amqps://prod-user:secret@rabbitmq.example.com:5671/production`
- Docker: `amqp://guest:guest@rabbitmq:5672/`

---

## Usage

### Publishing Messages

```csharp{title="Publishing Messages" description="Publishing Messages" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Publishing", "Messages"]}
public class ProductService {
    private readonly ITransport _transport;
    private readonly ILogger<ProductService> _logger;

    public ProductService(ITransport transport, ILogger<ProductService> logger) {
        _transport = transport;
        _logger = logger;
    }

    public async Task CreateProductAsync(CreateProductCommand command) {
        // Create message envelope
        var envelope = new MessageEnvelope<ProductCreatedEvent> {
            MessageId = MessageId.New(),
            Payload = new ProductCreatedEvent {
                ProductId = command.ProductId,
                Name = command.Name,
                Price = command.Price,
                CreatedAt = DateTime.UtcNow
            }
        };

        // Publish to exchange with routing key
        var destination = new TransportDestination(
            Address: "products",                    // Exchange name
            RoutingKey: "product.created",          // Routing key
            Metadata: new Dictionary<string, JsonElement> {
                ["Priority"] = JsonSerializer.SerializeToElement(5)
            }
        );

        await _transport.PublishAsync(envelope, destination);

        _logger.LogInformation("Published ProductCreatedEvent for {ProductId}", command.ProductId);
    }
}
```

### Subscribing to Messages

```csharp{title="Subscribing to Messages" description="Subscribing to Messages" category="Configuration" difficulty="ADVANCED" tags=["Messaging", "Transports", "Subscribing", "Messages"]}
public class InventoryWorker : BackgroundService {
    private readonly ITransport _transport;
    private readonly ILogger<InventoryWorker> _logger;
    private ISubscription? _subscription;

    public InventoryWorker(ITransport transport, ILogger<InventoryWorker> logger) {
        _transport = transport;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        var destination = new TransportDestination(
            Address: "products",                           // Exchange name
            RoutingKey: "inventory-products-queue",        // Queue name
            Metadata: new Dictionary<string, JsonElement> {
                ["RoutingPattern"] = JsonSerializer.SerializeToElement("product.*")
            }
        );

        _subscription = await _transport.SubscribeAsync(
            handler: async (envelope, envelopeType, ct) => {
                _logger.LogInformation("Received message: {MessageId}", envelope.MessageId);

                if (envelope.Payload is ProductCreatedEvent evt) {
                    await HandleProductCreatedAsync(evt, ct);
                }
            },
            destination,
            stoppingToken
        );

        _logger.LogInformation("Subscribed to products exchange");
    }

    private async Task HandleProductCreatedAsync(ProductCreatedEvent evt, CancellationToken ct) {
        // Update inventory levels
        _logger.LogInformation("Handling ProductCreatedEvent for {ProductId}", evt.ProductId);
        // ... business logic
    }

    public override async Task StopAsync(CancellationToken ct) {
        if (_subscription != null) {
            await _subscription.DisposeAsync();
        }
        await base.StopAsync(ct);
    }
}
```

### Custom Routing Patterns

```csharp{title="Custom Routing Patterns" description="Custom Routing Patterns" category="Configuration" difficulty="ADVANCED" tags=["Messaging", "Transports", "Custom", "Routing"]}
// Subscribe to specific event types
var destination = new TransportDestination(
    Address: "products",
    RoutingKey: "analytics-queue",
    Metadata: new Dictionary<string, JsonElement> {
        ["RoutingPattern"] = JsonSerializer.SerializeToElement("product.created")
    }
);

// Subscribe to all product events
var destination = new TransportDestination(
    Address: "products",
    RoutingKey: "audit-queue",
    Metadata: new Dictionary<string, JsonElement> {
        ["RoutingPattern"] = JsonSerializer.SerializeToElement("product.*")
    }
);

// Subscribe to all messages
var destination = new TransportDestination(
    Address: "products",
    RoutingKey: "logger-queue",
    Metadata: new Dictionary<string, JsonElement> {
        ["RoutingPattern"] = JsonSerializer.SerializeToElement("#")
    }
);
```

### Pause and Resume Subscriptions

```csharp{title="Pause and Resume Subscriptions" description="Pause and Resume Subscriptions" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Pause", "Resume"]}
public class OrderProcessor {
    private ISubscription? _subscription;

    public async Task PauseProcessingAsync() {
        if (_subscription != null) {
            await _subscription.PauseAsync();
            // Messages will be nack'd with requeue while paused
        }
    }

    public async Task ResumeProcessingAsync() {
        if (_subscription != null) {
            await _subscription.ResumeAsync();
            // Message processing continues
        }
    }
}
```

---

## Dead Letter Queues

### Automatic DLX/DLQ Setup

When `AutoDeclareDeadLetterExchange = true` (default), the transport automatically creates:

1. **Dead Letter Exchange** (`{exchange}.dlx`): Fanout exchange for failed messages
2. **Dead Letter Queue** (`{queue}.dlq`): Queue storing permanently failed messages
3. **DLX Binding**: Main queue declares `x-dead-letter-exchange` argument

### Message Retry Flow

```
┌─────────────────────┐
│  Main Queue         │
│  "orders-queue"     │
│                     │
│  Delivery attempt 1 │
│  ────────────────►  │
│       Nack          │
│  ◄────────────────  │
│                     │
│  Delivery attempt 2 │
│  ────────────────►  │
│       Nack          │
│  ◄────────────────  │
│                     │
│  ...                │
│                     │
│  Attempt 10 (max)   │
│  ────────────────►  │
│       Nack          │
│  ◄──────────────┘   │
│                     │
│  x-dead-letter-     │
│  exchange set       │
└──────│──────────────┘
       │
       │ Message moved to DLX
       ▼
┌─────────────────────┐
│  Dead Letter        │
│  Exchange           │
│  "orders.dlx"       │
└──────│──────────────┘
       │
       │ Fanout routing
       ▼
┌─────────────────────┐
│  Dead Letter Queue  │
│  "orders-queue.dlq" │
│                     │
│  Permanently failed │
│  messages stored    │
└─────────────────────┘
```

### Inspecting Failed Messages

```bash{title="Inspecting Failed Messages" description="Inspecting Failed Messages" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Inspecting", "Failed"]}
# List messages in DLQ
rabbitmqadmin get queue=orders-queue.dlq count=10

# Republish message from DLQ (manual intervention)
rabbitmqadmin get queue=orders-queue.dlq requeue=true
```

---

## Health Checks

### ASP.NET Core Health Checks

```csharp{title="ASP.NET Core Health Checks" description="ASP.NET Core Health Checks" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "ASP.NET", "Core"]}
using Whizbang.Transports.RabbitMQ;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRabbitMQTransport("amqp://localhost:5672/");
builder.Services.AddRabbitMQHealthChecks();

var app = builder.Build();

app.MapHealthChecks("/health");

app.Run();
```

**Health Check Response**:
```json{title="ASP.NET Core Health Checks (2)" description="Health Check Response:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "ASP.NET", "Core"]}
{
  "status": "Healthy",
  "results": {
    "rabbitmq": {
      "status": "Healthy",
      "description": "RabbitMQ connection is open",
      "data": {}
    }
  }
}
```

### Custom Readiness Checks

```csharp{title="Custom Readiness Checks" description="Custom Readiness Checks" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Custom", "Readiness"]}
public class RabbitMQReadinessCheck : ITransportReadinessCheck {
    private readonly IConnection _connection;

    public RabbitMQReadinessCheck(IConnection connection) {
        _connection = connection;
    }

    public ValueTask<bool> IsReadyAsync(CancellationToken ct = default) {
        return ValueTask.FromResult(_connection.IsOpen);
    }
}
```

---

## Testing

### Unit Testing with Test Doubles

```csharp{title="Unit Testing with Test Doubles" description="Unit Testing with Test Doubles" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Unit", "Testing"]}
using Whizbang.Transports.RabbitMQ;
using Whizbang.Transports.RabbitMQ.Tests;

public class ProductServiceTests {
    [Test]
    public async Task CreateProductAsync_PublishesEvent() {
        // Arrange
        var fakeConnection = new FakeConnection();
        var fakeChannel = new FakeChannel();
        fakeConnection.CreateModelReturns = fakeChannel;

        var transport = new RabbitMQTransport(
            fakeConnection,
            new RabbitMQOptions(),
            NullLogger<RabbitMQTransport>.Instance
        );

        var service = new ProductService(transport, NullLogger<ProductService>.Instance);

        // Act
        await service.CreateProductAsync(new CreateProductCommand {
            ProductId = ProductId.From(Guid.NewGuid()),
            Name = "Test Product",
            Price = 10.00m
        });

        // Assert
        await Assert.That(fakeChannel.BasicPublishCallCount).IsEqualTo(1);
        await Assert.That(fakeChannel.LastExchange).IsEqualTo("products");
        await Assert.That(fakeChannel.LastRoutingKey).IsEqualTo("product.created");
    }
}
```

### Integration Testing with TestContainers

```csharp{title="Integration Testing with TestContainers" description="Integration Testing with TestContainers" category="Configuration" difficulty="ADVANCED" tags=["Messaging", "Transports", "Integration", "Testing"]}
using Testcontainers.RabbitMQ;

[NotInParallel]  // RabbitMQ container isolation
public class RabbitMQIntegrationTests {
    private RabbitMqContainer? _container;
    private ITransport? _transport;

    [Before(Test)]
    public async Task SetupAsync() {
        // Start RabbitMQ container
        _container = new RabbitMqBuilder()
            .WithImage("rabbitmq:3.13-management-alpine")
            .WithPortBinding(5672, 5672)
            .WithPortBinding(15672, 15672)
            .Build();

        await _container.StartAsync();

        // Create transport
        var services = new ServiceCollection();
        services.AddRabbitMQTransport(_container.GetConnectionString());
        var provider = services.BuildServiceProvider();

        _transport = provider.GetRequiredService<ITransport>();
    }

    [Test]
    public async Task PublishAndSubscribe_MessageReceivedAsync() {
        // Arrange
        var receivedEvent = new TaskCompletionSource<ProductCreatedEvent>();

        var destination = new TransportDestination(
            Address: "test-products",
            RoutingKey: "test-queue"
        );

        // Subscribe
        await _transport!.SubscribeAsync(
            handler: (envelope, type, ct) => {
                if (envelope.Payload is ProductCreatedEvent evt) {
                    receivedEvent.SetResult(evt);
                }
                return ValueTask.CompletedTask;
            },
            destination,
            CancellationToken.None
        );

        // Act - Publish
        var expected = new ProductCreatedEvent {
            ProductId = ProductId.From(Guid.NewGuid()),
            Name = "Integration Test Product",
            Price = 99.99m
        };

        var envelope = new MessageEnvelope<ProductCreatedEvent> {
            MessageId = MessageId.New(),
            Payload = expected
        };

        await _transport.PublishAsync(envelope, destination);

        // Assert
        var received = await receivedEvent.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await Assert.That(received.ProductId).IsEqualTo(expected.ProductId);
        await Assert.That(received.Name).IsEqualTo(expected.Name);
    }

    [After(Test)]
    public async Task TeardownAsync() {
        if (_transport != null) {
            await _transport.DisposeAsync();
        }
        if (_container != null) {
            await _container.StopAsync();
        }
    }
}
```

---

## Best Practices

### 1. Channel Pool Sizing

**Guideline**: Set `MaxChannels` based on concurrent publishing threads.

```csharp{title="Channel Pool Sizing" description="Guideline: Set MaxChannels based on concurrent publishing threads." category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Channel", "Pool"]}
// Low throughput (< 10 msg/sec)
options.MaxChannels = 10;  // Default

// Medium throughput (10-100 msg/sec)
options.MaxChannels = 20;

// High throughput (> 100 msg/sec)
options.MaxChannels = 50;
```

**Why**: Channels are lightweight, but excessive pooling wastes resources. Profile your workload.

### 2. Prefetch Count Tuning

**Guideline**: Set `PrefetchCount` based on message processing time.

```csharp{title="Prefetch Count Tuning" description="Guideline: Set PrefetchCount based on message processing time." category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Prefetch", "Count"]}
// Fast processing (< 100ms per message)
options.PrefetchCount = 20;

// Medium processing (100ms - 1s)
options.PrefetchCount = 10;  // Default

// Slow processing (> 1s per message)
options.PrefetchCount = 1;
```

**Why**: Higher prefetch improves throughput but increases memory usage and delays redelivery on failure.

### 3. Retry Limits

**Guideline**: Set `MaxDeliveryAttempts` based on failure characteristics.

```csharp{title="Retry Limits" description="Guideline: Set MaxDeliveryAttempts based on failure characteristics." category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Retry", "Limits"]}
// Transient failures (network glitches)
options.MaxDeliveryAttempts = 3;

// Intermittent failures (external API timeouts)
options.MaxDeliveryAttempts = 5;

// Persistent failures (message format errors)
options.MaxDeliveryAttempts = 1;  // Fail fast to DLQ
```

**Why**: Excessive retries delay DLQ routing and waste resources.

### 4. Exchange and Queue Naming

**Convention**: Use hierarchical names for topic routing.

```csharp{title="Exchange and Queue Naming" description="Convention: Use hierarchical names for topic routing." category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Exchange", "Queue"]}
// Good - hierarchical routing
Address: "ecommerce.products"
RoutingKey: "product.created"

// Good - tenant isolation
Address: "tenant-123.orders"
RoutingKey: "order.*"

// Avoid - flat namespace
Address: "products"
RoutingKey: "created"
```

### 5. Dead Letter Queue Monitoring

**Setup alerting** for DLQ depth:

```bash{title="Dead Letter Queue Monitoring" description="Setup alerting for DLQ depth:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Dead", "Letter"]}
# Check DLQ message count
rabbitmqadmin list queues name messages | grep dlq

# Set CloudWatch/Prometheus alert
# If dlq_messages > threshold, investigate
```

**Why**: Messages in DLQ indicate persistent failures requiring manual intervention.

---

## Capabilities

The RabbitMQ transport supports the following `TransportCapabilities`:

| Capability | Supported | Notes |
|------------|-----------|-------|
| **PublishSubscribe** | ✅ Yes | Topic exchanges with wildcard routing |
| **Reliable** | ✅ Yes | At-least-once delivery with retries |
| **Ordered** | ❌ No | Not guaranteed with multiple consumers |
| **RequestResponse** | ❌ No | Not implemented in v1.0.0 |
| **ExactlyOnce** | ❌ No | Use inbox/outbox pattern (Whizbang.Core) |

**Ordering Considerations**:
- Single consumer per queue: Ordered within routing key
- Multiple consumers: No ordering guarantee
- Use partitioning or Azure Service Bus for strict ordering

---

## Troubleshooting

### Connection Refused

**Symptom**: `BrokerUnreachableException: None of the specified endpoints were reachable`

**Causes**:
1. RabbitMQ server not running
2. Incorrect connection string
3. Firewall blocking port 5672

**Solution**:
```bash{title="Connection Refused" description="Connection Refused" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Connection", "Refused"]}
# Check RabbitMQ is running
docker ps | grep rabbitmq

# Verify connection
telnet localhost 5672

# Check RabbitMQ logs
docker logs <rabbitmq-container>
```

### Channel Pool Exhaustion

**Symptom**: `PublishAsync()` hangs or times out

**Cause**: All channels rented, none returned (likely exception in `using` block)

**Solution**:
```csharp{title="Channel Pool Exhaustion" description="Channel Pool Exhaustion" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Channel", "Pool"]}
// Ensure channel returns on exception
try {
    using (var channel = await pool.RentChannelAsync()) {
        await transport.PublishAsync(envelope, destination);
    }  // Channel auto-returns here
} catch (Exception ex) {
    _logger.LogError(ex, "Publish failed");
    throw;
}
```

### Messages Not Routed

**Symptom**: Messages published but not received

**Causes**:
1. Exchange/queue binding mismatch
2. Incorrect routing key pattern
3. Queue not declared

**Diagnosis**:
```bash{title="Messages Not Routed" description="Messages Not Routed" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Messages", "Not"]}
# Check exchange exists
rabbitmqadmin list exchanges name type

# Check queue bindings
rabbitmqadmin list bindings source destination

# Inspect queue
rabbitmqadmin list queues name messages
```

### Dead Letter Loop

**Symptom**: Messages cycling between queue and DLQ

**Cause**: Handler always fails, message requeued from DLQ

**Solution**: Disable DLQ auto-requeue or fix handler logic.

---

## Performance Considerations

### Throughput Characteristics

**Baseline** (local RabbitMQ, default settings):
- **Publish**: ~2,000-5,000 msg/sec
- **Subscribe**: ~1,000-3,000 msg/sec (depends on handler)

**Tuning for High Throughput**:
1. Increase `MaxChannels` (50-100)
2. Increase `PrefetchCount` (20-50)
3. Use multiple consumers
4. Disable unnecessary plugins (management UI)

### Latency Characteristics

**Typical Latencies** (local RabbitMQ):
- **Publish**: 1-5 ms
- **End-to-End**: 10-50 ms (depends on handler)

**Reducing Latency**:
1. Reduce `PrefetchCount` (1-5)
2. Use faster serialization (System.Text.Json with source generation)
3. Optimize handler logic
4. Co-locate publisher and consumer

---

## Related Topics

- [Transports Overview](transports.md) - Compare transport implementations
- [Azure Service Bus Transport](azure-service-bus.md) - Alternative transport with strict ordering
- [In-Memory Transport](in-memory.md) - Testing and development
- [Custom Transports](../../extending/extensibility/custom-transports.md) - Implement your own transport
- [Lifecycle Hooks](../../fundamentals/lifecycle/lifecycle.md) - Pre/post processing for messages
- [Observability](../../fundamentals/persistence/observability.md) - OpenTelemetry tracing

---

## Code References

### Core Implementation
- [`RabbitMQTransport.cs`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Transports.RabbitMQ/RabbitMQTransport.cs) - Main transport implementation
- [`RabbitMQChannelPool.cs`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Transports.RabbitMQ/RabbitMQChannelPool.cs) - Thread-safe channel pooling
- [`RabbitMQOptions.cs`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Transports.RabbitMQ/RabbitMQOptions.cs) - Configuration options
- [`RabbitMQSubscription.cs`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Transports.RabbitMQ/RabbitMQSubscription.cs) - Subscription lifecycle

### Tests
- [`RabbitMQTransportTests.cs`](https://github.com/whizbang-lib/whizbang/blob/main/tests/Whizbang.Transports.RabbitMQ.Tests/RabbitMQTransportTests.cs) - Unit tests
- [`RabbitMQChannelPoolTests.cs`](https://github.com/whizbang-lib/whizbang/blob/main/tests/Whizbang.Transports.RabbitMQ.Tests/RabbitMQChannelPoolTests.cs) - Channel pool tests
- [Integration Tests](https://github.com/whizbang-lib/whizbang/tree/main/samples/ECommerce/tests/ECommerce.RabbitMQ.Integration.Tests) - TestContainers-based end-to-end tests

---

## Summary

The RabbitMQ transport provides a robust, performant foundation for distributed event-driven architectures with:

✅ **Reliable Delivery** - At-least-once guarantees with automatic retries
✅ **Flexible Routing** - Topic exchanges with wildcard patterns
✅ **AOT-Compatible** - Source-generated JSON serialization
✅ **Thread-Safe** - Channel pooling for concurrent publishing
✅ **Dead Letter Queues** - Automatic failure handling and observability
✅ **Production-Ready** - Health checks, pause/resume, TestContainers integration

**Next Steps**:
1. [Install and configure](#installation) the RabbitMQ transport
2. Review [usage examples](#usage) for publishing and subscribing
3. Explore [integration tests](https://github.com/whizbang-lib/whizbang/tree/main/samples/ECommerce/tests/ECommerce.RabbitMQ.Integration.Tests) for real-world patterns
4. Read [best practices](#best-practices) for production deployments
