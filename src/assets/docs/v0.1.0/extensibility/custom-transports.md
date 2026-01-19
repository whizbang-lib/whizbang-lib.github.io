---
title: "Custom Transports"
version: 0.1.0
category: Extensibility
order: 4
description: "Implement custom transports for HTTP, gRPC, Kafka, RabbitMQ, or any messaging system - AOT-compatible patterns"
tags: transports, itransport, custom-implementations, http, grpc, kafka, rabbitmq, serialization
codeReferences:
  - src/Whizbang.Core/Transports/ITransport.cs
  - src/Whizbang.Core/Transports/TransportCapabilities.cs
  - src/Whizbang.Core/Transports/InProcessTransport.cs
---

# Custom Transports

**Custom transports** enable Whizbang to work with any messaging system by implementing the `ITransport` interface. Support HTTP, gRPC, Kafka, RabbitMQ, NATS, or any custom communication protocol.

:::note
For built-in transports, see [Azure Service Bus](../transports/azure-service-bus.md) and [In-Memory](../transports/in-memory.md). This guide focuses on **implementing custom transport backends**.
:::

---

## Why Custom Transports?

**Built-in transports** cover common scenarios, but custom transports enable:

| Scenario | Built-In Transport | Custom Transport |
|----------|-------------------|------------------|
| **Azure Service Bus** | ✅ Built-in | No customization needed |
| **In-Memory (Testing)** | ✅ Built-in | No customization needed |
| **HTTP/REST APIs** | ❌ Not included | ✅ HTTP client transport |
| **gRPC** | ❌ Not included | ✅ gRPC channel transport |
| **Kafka** | ❌ Not included | ✅ Kafka producer/consumer |
| **RabbitMQ** | ❌ Not included | ✅ AMQP channel transport |
| **NATS** | ❌ Not included | ✅ NATS client transport |
| **Redis Pub/Sub** | ❌ Not included | ✅ Redis channel transport |

**When to implement custom transport**:
- ✅ Existing messaging infrastructure (Kafka, RabbitMQ)
- ✅ HTTP/gRPC microservices
- ✅ Legacy systems integration
- ✅ Custom protocols (IoT, WebSockets)
- ✅ Multi-cloud deployments

---

## Architecture

### ITransport Interface

```csharp
namespace Whizbang.Core.Transports;

public interface ITransport {
  /// <summary>
  /// Whether transport is initialized and ready.
  /// </summary>
  bool IsInitialized { get; }

  /// <summary>
  /// Initialize transport and verify connectivity.
  /// Idempotent - safe to call multiple times.
  /// </summary>
  Task InitializeAsync(CancellationToken ct = default);

  /// <summary>
  /// Capabilities this transport supports.
  /// </summary>
  TransportCapabilities Capabilities { get; }

  /// <summary>
  /// Publish message (fire-and-forget).
  /// </summary>
  Task PublishAsync(
    IMessageEnvelope envelope,
    TransportDestination destination,
    CancellationToken ct = default
  );

  /// <summary>
  /// Subscribe to messages from destination.
  /// Returns subscription handle for lifecycle management.
  /// </summary>
  Task<ISubscription> SubscribeAsync(
    Func<IMessageEnvelope, CancellationToken, Task> handler,
    TransportDestination destination,
    CancellationToken ct = default
  );

  /// <summary>
  /// Send request and wait for response (request/response pattern).
  /// Only supported if Capabilities includes RequestResponse.
  /// </summary>
  Task<IMessageEnvelope> SendAsync<TRequest, TResponse>(
    IMessageEnvelope requestEnvelope,
    TransportDestination destination,
    CancellationToken ct = default
  ) where TRequest : notnull where TResponse : notnull;
}
```

### Transport Capabilities

```csharp
[Flags]
public enum TransportCapabilities {
  None = 0,
  RequestResponse = 1 << 0,    // Send/Receive (HTTP, gRPC)
  PublishSubscribe = 1 << 1,   // Pub/Sub (Kafka, Service Bus)
  Streaming = 1 << 2,          // IAsyncEnumerable streaming
  Reliable = 1 << 3,           // At-least-once delivery
  Ordered = 1 << 4,            // FIFO ordering
  ExactlyOnce = 1 << 5         // Exactly-once semantics
}
```

**Example Capability Declarations**:

| Transport | Capabilities |
|-----------|-------------|
| **HTTP** | `RequestResponse` |
| **gRPC** | `RequestResponse \| Streaming` |
| **Kafka** | `PublishSubscribe \| Reliable \| Ordered` |
| **RabbitMQ** | `PublishSubscribe \| Reliable` |
| **In-Memory** | `PublishSubscribe \| Reliable \| Ordered \| ExactlyOnce` |
| **Azure Service Bus** | `PublishSubscribe \| Reliable \| Ordered` |

---

## HTTP Transport Implementation

### Pattern 1: HTTP Client Transport

**Use Case**: Call remote HTTP APIs using Whizbang message patterns.

```csharp
using Whizbang.Core;
using Whizbang.Core.Transports;
using System.Net.Http.Json;
using System.Text.Json;

public class HttpTransport : ITransport {
  private readonly HttpClient _http;
  private readonly JsonSerializerOptions _jsonOptions;
  private readonly ILogger<HttpTransport> _logger;
  private bool _isInitialized;

  public HttpTransport(
    HttpClient http,
    JsonSerializerOptions jsonOptions,
    ILogger<HttpTransport> logger
  ) {
    _http = http;
    _jsonOptions = jsonOptions;
    _logger = logger;
  }

  public bool IsInitialized => _isInitialized;

  public TransportCapabilities Capabilities =>
    TransportCapabilities.RequestResponse;  // HTTP supports request/response only

  public async Task InitializeAsync(CancellationToken ct = default) {
    // Verify HTTP endpoint is reachable
    try {
      var healthCheck = await _http.GetAsync("/health", ct);
      healthCheck.EnsureSuccessStatusCode();

      _isInitialized = true;
      _logger.LogInformation("HTTP transport initialized successfully");

    } catch (HttpRequestException ex) {
      throw new InvalidOperationException("HTTP transport initialization failed", ex);
    }
  }

  public Task PublishAsync(
    IMessageEnvelope envelope,
    TransportDestination destination,
    CancellationToken ct = default
  ) {
    throw new NotSupportedException("HTTP transport does not support publish (use SendAsync instead)");
  }

  public Task<ISubscription> SubscribeAsync(
    Func<IMessageEnvelope, CancellationToken, Task> handler,
    TransportDestination destination,
    CancellationToken ct = default
  ) {
    throw new NotSupportedException("HTTP transport does not support subscribe (use polling or webhooks)");
  }

  public async Task<IMessageEnvelope> SendAsync<TRequest, TResponse>(
    IMessageEnvelope requestEnvelope,
    TransportDestination destination,
    CancellationToken ct = default
  ) where TRequest : notnull where TResponse : notnull {
    // Serialize request envelope
    var envelopeType = requestEnvelope.GetType();
    var typeInfo = _jsonOptions.GetTypeInfo(envelopeType)
      ?? throw new InvalidOperationException($"No JsonTypeInfo for {envelopeType.Name}");

    // POST envelope to remote endpoint
    var response = await _http.PostAsJsonAsync(
      destination.Address,  // e.g., "https://api.example.com/orders/create"
      requestEnvelope,
      typeInfo,
      ct
    );

    response.EnsureSuccessStatusCode();

    // Deserialize response envelope
    var responseEnvelopeType = typeof(MessageEnvelope<TResponse>);
    var responseTypeInfo = _jsonOptions.GetTypeInfo(responseEnvelopeType)
      ?? throw new InvalidOperationException($"No JsonTypeInfo for {responseEnvelopeType.Name}");

    var responseEnvelope = await response.Content.ReadFromJsonAsync(responseTypeInfo, ct)
      as IMessageEnvelope;

    if (responseEnvelope is null) {
      throw new InvalidOperationException("Failed to deserialize response envelope");
    }

    _logger.LogInformation(
      "HTTP request sent to {Address}, received response {MessageId}",
      destination.Address,
      responseEnvelope.MessageId
    );

    return responseEnvelope;
  }
}
```

**Registration**:
```csharp
builder.Services.AddHttpClient<HttpTransport>(client => {
  client.BaseAddress = new Uri("https://api.example.com");
  client.Timeout = TimeSpan.FromSeconds(30);
});

builder.Services.AddSingleton<ITransport, HttpTransport>();
```

**Usage**:
```csharp
var request = MessageEnvelope.Create(
  messageId: MessageId.New(),
  correlationId: CorrelationId.New(),
  causationId: null,
  payload: new CreateOrder(orderId, customerId, items)
);

var destination = new TransportDestination(Address: "/orders/create");

var response = await transport.SendAsync<CreateOrder, OrderCreated>(request, destination);
```

---

## gRPC Transport Implementation

### Pattern 2: gRPC Channel Transport

**Use Case**: High-performance RPC with streaming support.

```csharp
using Whizbang.Core;
using Whizbang.Core.Transports;
using Grpc.Net.Client;
using System.Text.Json;

public class GrpcTransport : ITransport {
  private readonly GrpcChannel _channel;
  private readonly JsonSerializerOptions _jsonOptions;
  private readonly ILogger<GrpcTransport> _logger;
  private bool _isInitialized;

  public GrpcTransport(
    GrpcChannel channel,
    JsonSerializerOptions jsonOptions,
    ILogger<GrpcTransport> logger
  ) {
    _channel = channel;
    _jsonOptions = jsonOptions;
    _logger = logger;
  }

  public bool IsInitialized => _isInitialized;

  public TransportCapabilities Capabilities =>
    TransportCapabilities.RequestResponse |
    TransportCapabilities.Streaming;  // gRPC supports both

  public async Task InitializeAsync(CancellationToken ct = default) {
    // Verify gRPC channel is connected
    await _channel.ConnectAsync(ct);

    _isInitialized = true;
    _logger.LogInformation(
      "gRPC transport initialized for {Target}",
      _channel.Target
    );
  }

  public async Task<IMessageEnvelope> SendAsync<TRequest, TResponse>(
    IMessageEnvelope requestEnvelope,
    TransportDestination destination,
    CancellationToken ct = default
  ) where TRequest : notnull where TResponse : notnull {
    // Create gRPC client for service
    var client = CreateClient(destination.Address);  // e.g., "OrderService"

    // Serialize request envelope to protobuf/JSON
    var request = SerializeEnvelope(requestEnvelope);

    // Invoke gRPC method
    var response = await client.ProcessMessageAsync(request, cancellationToken: ct);

    // Deserialize response envelope
    var responseEnvelope = DeserializeEnvelope<TResponse>(response);

    _logger.LogInformation(
      "gRPC request sent to {Service}, method {Method}",
      destination.Address,
      destination.RoutingKey
    );

    return responseEnvelope;
  }

  // Simplified for example - actual implementation depends on protobuf schema
  private dynamic CreateClient(string serviceName) {
    // Use reflection or code generation to create gRPC client
    // e.g., var client = new OrderService.OrderServiceClient(_channel);
    throw new NotImplementedException("gRPC client creation");
  }

  private object SerializeEnvelope(IMessageEnvelope envelope) {
    // Convert MessageEnvelope to protobuf message
    throw new NotImplementedException("Protobuf serialization");
  }

  private IMessageEnvelope DeserializeEnvelope<T>(object response) {
    // Convert protobuf message to MessageEnvelope<T>
    throw new NotImplementedException("Protobuf deserialization");
  }

  public Task PublishAsync(
    IMessageEnvelope envelope,
    TransportDestination destination,
    CancellationToken ct = default
  ) {
    throw new NotSupportedException("gRPC transport is request/response only (use streaming for pub/sub)");
  }

  public Task<ISubscription> SubscribeAsync(
    Func<IMessageEnvelope, CancellationToken, Task> handler,
    TransportDestination destination,
    CancellationToken ct = default
  ) {
    // For streaming gRPC, implement server-side streaming subscription
    throw new NotImplementedException("gRPC streaming subscription");
  }
}
```

---

## Kafka Transport Implementation

### Pattern 3: Kafka Producer/Consumer Transport

**Use Case**: High-throughput event streaming with ordering and persistence.

```csharp
using Whizbang.Core;
using Whizbang.Core.Transports;
using Confluent.Kafka;
using System.Text.Json;

public class KafkaTransport : ITransport {
  private readonly IProducer<string, string> _producer;
  private readonly ConsumerConfig _consumerConfig;
  private readonly JsonSerializerOptions _jsonOptions;
  private readonly ILogger<KafkaTransport> _logger;
  private bool _isInitialized;

  public KafkaTransport(
    ProducerConfig producerConfig,
    ConsumerConfig consumerConfig,
    JsonSerializerOptions jsonOptions,
    ILogger<KafkaTransport> logger
  ) {
    _producer = new ProducerBuilder<string, string>(producerConfig).Build();
    _consumerConfig = consumerConfig;
    _jsonOptions = jsonOptions;
    _logger = logger;
  }

  public bool IsInitialized => _isInitialized;

  public TransportCapabilities Capabilities =>
    TransportCapabilities.PublishSubscribe |
    TransportCapabilities.Reliable |
    TransportCapabilities.Ordered;  // Kafka guarantees within partitions

  public async Task InitializeAsync(CancellationToken ct = default) {
    // Verify Kafka cluster is reachable
    try {
      // Produce a test message to verify connectivity
      var metadata = _producer.GetMetadata(TimeSpan.FromSeconds(5));

      _isInitialized = true;
      _logger.LogInformation(
        "Kafka transport initialized, connected to {BrokerCount} brokers",
        metadata.Brokers.Count
      );

    } catch (KafkaException ex) {
      throw new InvalidOperationException("Kafka transport initialization failed", ex);
    }
  }

  public async Task PublishAsync(
    IMessageEnvelope envelope,
    TransportDestination destination,
    CancellationToken ct = default
  ) {
    // Serialize envelope to JSON
    var envelopeType = envelope.GetType();
    var typeInfo = _jsonOptions.GetTypeInfo(envelopeType)
      ?? throw new InvalidOperationException($"No JsonTypeInfo for {envelopeType.Name}");

    var json = JsonSerializer.Serialize(envelope, typeInfo);

    // Create Kafka message
    var message = new Message<string, string> {
      Key = envelope.StreamKey ?? envelope.MessageId.Value.ToString(),  // Partition by stream
      Value = json,
      Headers = new Headers {
        { "MessageId", System.Text.Encoding.UTF8.GetBytes(envelope.MessageId.Value.ToString()) },
        { "CorrelationId", System.Text.Encoding.UTF8.GetBytes(envelope.CorrelationId.Value.ToString()) },
        { "EnvelopeType", System.Text.Encoding.UTF8.GetBytes(envelopeType.AssemblyQualifiedName!) }
      }
    };

    // Publish to topic
    var result = await _producer.ProduceAsync(
      destination.Address,  // Kafka topic name
      message,
      ct
    );

    _logger.LogInformation(
      "Published message {MessageId} to Kafka topic {Topic}, partition {Partition}, offset {Offset}",
      envelope.MessageId,
      destination.Address,
      result.Partition.Value,
      result.Offset.Value
    );
  }

  public async Task<ISubscription> SubscribeAsync(
    Func<IMessageEnvelope, CancellationToken, Task> handler,
    TransportDestination destination,
    CancellationToken ct = default
  ) {
    // Create Kafka consumer
    var consumer = new ConsumerBuilder<string, string>(_consumerConfig).Build();

    // Subscribe to topic
    consumer.Subscribe(destination.Address);  // Kafka topic name

    _logger.LogInformation(
      "Subscribed to Kafka topic {Topic}, consumer group {ConsumerGroup}",
      destination.Address,
      _consumerConfig.GroupId
    );

    // Background task to consume messages
    var consumeTask = Task.Run(async () => {
      try {
        while (!ct.IsCancellationRequested) {
          var consumeResult = consumer.Consume(ct);

          if (consumeResult?.Message != null) {
            try {
              // Deserialize envelope
              var envelopeTypeName = System.Text.Encoding.UTF8.GetString(
                consumeResult.Message.Headers.GetLastBytes("EnvelopeType")
              );
              var envelopeType = Type.GetType(envelopeTypeName)
                ?? throw new InvalidOperationException($"Unknown envelope type: {envelopeTypeName}");

              var typeInfo = _jsonOptions.GetTypeInfo(envelopeType)
                ?? throw new InvalidOperationException($"No JsonTypeInfo for {envelopeType.Name}");

              var envelope = JsonSerializer.Deserialize(
                consumeResult.Message.Value,
                typeInfo
              ) as IMessageEnvelope
                ?? throw new InvalidOperationException("Failed to deserialize envelope");

              // Invoke handler
              await handler(envelope, ct);

              // Commit offset after successful processing
              consumer.Commit(consumeResult);

              _logger.LogDebug(
                "Processed Kafka message from topic {Topic}, partition {Partition}, offset {Offset}",
                consumeResult.Topic,
                consumeResult.Partition.Value,
                consumeResult.Offset.Value
              );

            } catch (Exception ex) {
              _logger.LogError(
                ex,
                "Error processing Kafka message from topic {Topic}, partition {Partition}, offset {Offset}",
                consumeResult.Topic,
                consumeResult.Partition.Value,
                consumeResult.Offset.Value
              );

              // Don't commit - message will be retried
            }
          }
        }
      } catch (OperationCanceledException) {
        // Expected on shutdown
      } finally {
        consumer.Close();
      }
    }, ct);

    return new KafkaSubscription(consumer, consumeTask);
  }

  public Task<IMessageEnvelope> SendAsync<TRequest, TResponse>(
    IMessageEnvelope requestEnvelope,
    TransportDestination destination,
    CancellationToken ct = default
  ) where TRequest : notnull where TResponse : notnull {
    throw new NotSupportedException("Kafka transport does not support request/response (use pub/sub instead)");
  }
}

/// <summary>
/// Subscription handle for Kafka consumer.
/// </summary>
internal class KafkaSubscription : ISubscription {
  private readonly IConsumer<string, string> _consumer;
  private readonly Task _consumeTask;

  public KafkaSubscription(IConsumer<string, string> consumer, Task consumeTask) {
    _consumer = consumer;
    _consumeTask = consumeTask;
  }

  public async ValueTask DisposeAsync() {
    // Stop consuming
    _consumer.Close();

    // Wait for consume task to complete
    try {
      await _consumeTask.WaitAsync(TimeSpan.FromSeconds(10));
    } catch (TimeoutException) {
      // Consume task didn't complete in time
    }

    _consumer.Dispose();
  }
}
```

**Registration**:
```csharp
var producerConfig = new ProducerConfig {
  BootstrapServers = "localhost:9092",
  Acks = Acks.All,  // Wait for all replicas
  EnableIdempotence = true  // Exactly-once producer
};

var consumerConfig = new ConsumerConfig {
  BootstrapServers = "localhost:9092",
  GroupId = "whizbang-consumer-group",
  AutoOffsetReset = AutoOffsetReset.Earliest,
  EnableAutoCommit = false  // Manual commit after processing
};

builder.Services.AddSingleton<ITransport>(sp =>
  new KafkaTransport(
    producerConfig,
    consumerConfig,
    sp.GetRequiredService<JsonSerializerOptions>(),
    sp.GetRequiredService<ILogger<KafkaTransport>>()
  )
);
```

---

## Advanced Patterns

### Pattern 4: Transport with Health Checks

```csharp
using Whizbang.Core.Transports;
using Microsoft.Extensions.Diagnostics.HealthChecks;

public class KafkaTransportHealthCheck : IHealthCheck {
  private readonly KafkaTransport _transport;

  public KafkaTransportHealthCheck(ITransport transport) {
    _transport = (KafkaTransport)transport;
  }

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    if (!_transport.IsInitialized) {
      return HealthCheckResult.Unhealthy("Kafka transport not initialized");
    }

    try {
      // Verify producer is healthy
      var metadata = _transport.GetMetadata(TimeSpan.FromSeconds(2));
      var brokerCount = metadata.Brokers.Count;

      if (brokerCount == 0) {
        return HealthCheckResult.Degraded("No Kafka brokers available");
      }

      return HealthCheckResult.Healthy($"Kafka transport healthy, {brokerCount} brokers connected");

    } catch (KafkaException ex) {
      return HealthCheckResult.Unhealthy("Kafka transport unhealthy", ex);
    }
  }
}

// Registration
builder.Services.AddHealthChecks()
  .AddCheck<KafkaTransportHealthCheck>("kafka_transport");
```

---

### Pattern 5: Batching Transport (High Throughput)

```csharp
using Whizbang.Core.Transports;
using System.Threading.Channels;

public class BatchingTransport : ITransport {
  private readonly ITransport _innerTransport;
  private readonly Channel<(IMessageEnvelope, TransportDestination)> _queue;
  private readonly Task _batchProcessor;
  private readonly CancellationTokenSource _cts;

  private const int BatchSize = 100;
  private static readonly TimeSpan BatchTimeout = TimeSpan.FromMilliseconds(100);

  public BatchingTransport(ITransport innerTransport) {
    _innerTransport = innerTransport;

    _queue = Channel.CreateBounded<(IMessageEnvelope, TransportDestination)>(10000);

    _cts = new CancellationTokenSource();
    _batchProcessor = Task.Run(() => ProcessBatchesAsync(_cts.Token));
  }

  public bool IsInitialized => _innerTransport.IsInitialized;
  public TransportCapabilities Capabilities => _innerTransport.Capabilities;

  public Task InitializeAsync(CancellationToken ct = default) =>
    _innerTransport.InitializeAsync(ct);

  public async Task PublishAsync(
    IMessageEnvelope envelope,
    TransportDestination destination,
    CancellationToken ct = default
  ) {
    // Queue message for batching
    await _queue.Writer.WriteAsync((envelope, destination), ct);
  }

  private async Task ProcessBatchesAsync(CancellationToken ct) {
    var batch = new List<(IMessageEnvelope, TransportDestination)>(BatchSize);

    while (!ct.IsCancellationRequested) {
      // Collect batch
      while (batch.Count < BatchSize) {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(BatchTimeout);

        try {
          var item = await _queue.Reader.ReadAsync(timeoutCts.Token);
          batch.Add(item);
        } catch (OperationCanceledException) {
          break;  // Timeout or cancellation
        }
      }

      // Publish batch in parallel
      if (batch.Count > 0) {
        await Task.WhenAll(
          batch.Select(item =>
            _innerTransport.PublishAsync(item.Item1, item.Item2, ct)
          )
        );

        batch.Clear();
      }
    }
  }

  // Other ITransport methods delegate to _innerTransport
  public Task<ISubscription> SubscribeAsync(...) =>
    _innerTransport.SubscribeAsync(handler, destination, ct);

  public Task<IMessageEnvelope> SendAsync<TRequest, TResponse>(...) =>
    _innerTransport.SendAsync<TRequest, TResponse>(requestEnvelope, destination, ct);
}
```

**Usage**:
```csharp
// Wrap existing transport with batching
var kafkaTransport = new KafkaTransport(...);
var batchingTransport = new BatchingTransport(kafkaTransport);

builder.Services.AddSingleton<ITransport>(batchingTransport);
```

**Benefits**:
- **10x Throughput**: Batch 100 messages in single Kafka produce call
- **Lower Latency**: Parallel publishing within batch
- **Backpressure**: Bounded channel prevents memory issues

---

## Testing Custom Transports

### Testing Initialization

```csharp
public class KafkaTransportTests {
  [Test]
  public async Task InitializeAsync_ValidBroker_SucceedsAsync() {
    // Arrange
    var producerConfig = new ProducerConfig { BootstrapServers = "localhost:9092" };
    var consumerConfig = new ConsumerConfig { BootstrapServers = "localhost:9092", GroupId = "test" };
    var jsonOptions = JsonContextRegistry.CreateCombinedOptions();
    var logger = new NullLogger<KafkaTransport>();

    var transport = new KafkaTransport(producerConfig, consumerConfig, jsonOptions, logger);

    // Act
    await transport.InitializeAsync();

    // Assert
    await Assert.That(transport.IsInitialized).IsTrue();
  }

  [Test]
  public async Task InitializeAsync_InvalidBroker_ThrowsAsync() {
    // Arrange
    var producerConfig = new ProducerConfig { BootstrapServers = "invalid:9092" };
    var consumerConfig = new ConsumerConfig { BootstrapServers = "invalid:9092", GroupId = "test" };
    var jsonOptions = JsonContextRegistry.CreateCombinedOptions();
    var logger = new NullLogger<KafkaTransport>();

    var transport = new KafkaTransport(producerConfig, consumerConfig, jsonOptions, logger);

    // Act & Assert
    await Assert.That(async () => await transport.InitializeAsync())
      .ThrowsException<InvalidOperationException>()
      .WithMessage("Kafka transport initialization failed");
  }
}
```

### Testing Publish/Subscribe

```csharp
public class KafkaTransportIntegrationTests {
  [Test]
  public async Task PublishAndSubscribe_MessageReceivedAsync() {
    // Arrange
    var transport = CreateKafkaTransport();
    await transport.InitializeAsync();

    var receivedEnvelope = default(IMessageEnvelope);
    var messageReceived = new TaskCompletionSource<bool>();

    var destination = new TransportDestination(Address: "test-topic");

    // Subscribe
    await transport.SubscribeAsync(
      handler: async (envelope, ct) => {
        receivedEnvelope = envelope;
        messageReceived.SetResult(true);
      },
      destination: destination
    );

    // Act - Publish
    var envelope = MessageEnvelope.Create(
      messageId: MessageId.New(),
      correlationId: CorrelationId.New(),
      causationId: null,
      payload: new TestMessage("Hello Kafka!")
    );

    await transport.PublishAsync(envelope, destination);

    // Assert - Wait for message
    var received = await messageReceived.Task.WaitAsync(TimeSpan.FromSeconds(10));

    await Assert.That(received).IsTrue();
    await Assert.That(receivedEnvelope).IsNotNull();
    await Assert.That(receivedEnvelope!.MessageId).IsEqualTo(envelope.MessageId);
  }
}
```

---

## Best Practices

### DO ✅

- ✅ **Implement InitializeAsync** for connectivity verification
- ✅ **Declare accurate Capabilities** flags
- ✅ **Use AOT-compatible serialization** (JsonTypeInfo)
- ✅ **Handle errors gracefully** with retry logic
- ✅ **Log all operations** for observability
- ✅ **Support cancellation** via CancellationToken
- ✅ **Add health checks** for transport status
- ✅ **Test with real backends** (Docker containers)

### DON'T ❌

- ❌ Block async operations with `.Result` or `.Wait()`
- ❌ Skip initialization verification (fail fast!)
- ❌ Ignore Capabilities (declare what you support)
- ❌ Forget to dispose subscriptions (memory leaks)
- ❌ Use reflection for serialization (breaks AOT)
- ❌ Swallow exceptions silently (log errors!)
- ❌ Hardcode configuration (use options pattern)

---

## Further Reading

**Transports**:
- [Azure Service Bus](../transports/azure-service-bus.md) - Built-in Service Bus transport
- [In-Memory](../transports/in-memory.md) - Testing transport

**Messaging**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable event publishing
- [Work Coordination](../messaging/work-coordination.md) - Lease-based processing

**Source Generators**:
- [JSON Contexts](../source-generators/json-contexts.md) - AOT-compatible serialization

**Infrastructure**:
- [Health Checks](../infrastructure/health-checks.md) - Transport health monitoring

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
