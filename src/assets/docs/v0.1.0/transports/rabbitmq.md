---
title: "RabbitMQ Transport"
version: 0.1.0
category: Transports
order: 2
description: "Distributed event-driven messaging with RabbitMQ topic exchanges - AOT-compatible with channel pooling and dead-letter queue support"
tags: transports, rabbitmq, messaging, topic-exchange, dead-letter-queue, channel-pool, aot, testcontainers
codeReferences:
  - src/Whizbang.Transports.RabbitMQ/RabbitMQTransport.cs
  - src/Whizbang.Transports.RabbitMQ/ServiceCollectionExtensions.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMQOptions.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMQChannelPool.cs
testReferences:
  - tests/Whizbang.Transports.RabbitMQ.Tests/RabbitMQTransportTests.cs
  - tests/Whizbang.Transports.RabbitMQ.Tests/RabbitMQChannelPoolTests.cs
  - samples/ECommerce/tests/ECommerce.RabbitMQ.Integration.Tests/
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

```xml
<PackageReference Include="Whizbang.Transports.RabbitMQ" Version="0.1.0" />
```

### Dependencies

```xml
<ItemGroup>
  <PackageReference Include="RabbitMQ.Client" Version="7.1.2" />
  <PackageReference Include="Microsoft.Extensions.DependencyInjection.Abstractions" Version="10.0.1" />
  <PackageReference Include="Microsoft.Extensions.Diagnostics.HealthChecks" Version="10.0.1" />
</ItemGroup>
```

---

## Configuration

### Basic Setup

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```bash
# List messages in DLQ
rabbitmqadmin get queue=orders-queue.dlq count=10

# Republish message from DLQ (manual intervention)
rabbitmqadmin get queue=orders-queue.dlq requeue=true
```

---

## Health Checks

### ASP.NET Core Health Checks

```csharp
using Whizbang.Transports.RabbitMQ;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRabbitMQTransport("amqp://localhost:5672/");
builder.Services.AddRabbitMQHealthChecks();

var app = builder.Build();

app.MapHealthChecks("/health");

app.Run();
```

**Health Check Response**:
```json
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

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```bash
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
| **RequestResponse** | ❌ No | Not implemented in v0.1.0 |
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
```bash
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
```csharp
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
```bash
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

- [Transports Overview](/components/transports) - Compare transport implementations
- [Azure Service Bus Transport](/transports/azure-service-bus) - Alternative transport with strict ordering
- [In-Memory Transport](/transports/in-memory) - Testing and development
- [Custom Transports](/extensibility/custom-transports) - Implement your own transport
- [Lifecycle Hooks](/core-concepts/lifecycle) - Pre/post processing for messages
- [Observability](/core-concepts/observability) - OpenTelemetry tracing

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
