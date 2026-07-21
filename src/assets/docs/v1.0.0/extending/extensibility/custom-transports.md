---
title: Custom Transports
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Extensibility
order: 4
description: >-
  Implement custom transports for HTTP, gRPC, Kafka, RabbitMQ, or any messaging
  system - AOT-compatible patterns
tags: >-
  transports, itransport, custom-implementations, http, grpc, kafka, rabbitmq,
  serialization
codeReferences:
  - src/Whizbang.Core/Transports/ITransport.cs
  - src/Whizbang.Core/Transports/TransportCapabilities.cs
  - src/Whizbang.Core/Transports/InProcessTransport.cs
  - src/Whizbang.Core/Transports/ISubscription.cs
  - src/Whizbang.Core/Transports/TransportDestination.cs
  - src/Whizbang.Core/Transports/BulkPublish.cs
  - src/Whizbang.Core/Workers/TransportBatchOptions.cs
testReferences:
  - tests/Whizbang.Transports.Tests/ITransportTests.cs
  - tests/Whizbang.Transports.Tests/TransportCapabilitiesTests.cs
  - tests/Whizbang.Transports.Tests/SubscribeBatchTests.cs
  - tests/Whizbang.Transports.Tests/ISubscriptionTests.cs
  - tests/Whizbang.Transports.Tests/InProcessTransportTests.cs
  - tests/Whizbang.Transports.Tests/TransportDestinationTests.cs
  - tests/Whizbang.Transports.Tests/ITransportSubscribeToDeadLetterAsyncDefaultTests.cs
lastMaintainedCommit: '01f07906'
---

# Custom Transports

**Custom transports** enable Whizbang to work with any messaging system by implementing the `ITransport` interface. Support HTTP, gRPC, Kafka, RabbitMQ, NATS, or any custom communication protocol.

:::note
For built-in transports, see [Azure Service Bus](../../messaging/transports/azure-service-bus.md) and [In-Memory](../../messaging/transports/in-memory.md). This guide focuses on **implementing custom transport backends**.
:::

---

## Why Custom Transports?

**Built-in transports** cover common scenarios, but custom transports enable:

| Scenario | Built-In Transport | Custom Transport |
|----------|-------------------|------------------|
| **Azure Service Bus** | ✅ Built-in (`Whizbang.Transports.AzureServiceBus`) | No customization needed |
| **RabbitMQ** | ✅ Built-in (`Whizbang.Transports.RabbitMQ`) | No customization needed |
| **In-Process (Testing)** | ✅ Built-in (`InProcessTransport`) | No customization needed |
| **HTTP/REST APIs** | ❌ Not included | ✅ HTTP client transport |
| **gRPC** | ❌ Not included | ✅ gRPC channel transport |
| **Kafka** | ❌ Not included | ✅ Kafka producer/consumer |
| **NATS** | ❌ Not included | ✅ NATS client transport |
| **Redis Pub/Sub** | ❌ Not included | ✅ Redis channel transport |

**When to implement custom transport**:
- ✅ Existing messaging infrastructure (Kafka, NATS)
- ✅ HTTP/gRPC microservices
- ✅ Legacy systems integration
- ✅ Custom protocols (IoT, WebSockets)
- ✅ Multi-cloud deployments

---

## Architecture

### ITransport Interface

```csharp{title="ITransport Interface" description="ITransport Interface" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "ITransport", "Interface"] tests=["ITransportTests.ITransport_Capabilities_ReturnsTransportCapabilitiesAsync", "ITransportTests.ITransport_PublishAsync_WithValidMessage_CompletesSuccessfullyAsync", "ITransportTests.ITransport_SubscribeBatchAsync_RegistersHandler_ReturnsSubscriptionAsync", "ITransportTests.ITransport_SendAsync_WithTimeout_ThrowsTimeoutExceptionAsync", "ITransportTests.ITransport_MaxMessageSizeBytes_InProcessTransport_ReturnsNullAsync", "ITransportTests.ITransport_PublishBatchAsync_WithoutBulkPublishCapability_ThrowsNotSupportedExceptionAsync"]}
namespace Whizbang.Core.Transports;

/// <summary>
/// A deserialized transport message ready for batch processing.
/// Value type to avoid heap allocations when batching many messages.
/// </summary>
public readonly record struct TransportMessage(
  IMessageEnvelope Envelope,
  string? EnvelopeType
);

public interface ITransport {
  /// <summary>
  /// Whether transport is initialized and ready.
  /// </summary>
  bool IsInitialized { get; }

  /// <summary>
  /// Initialize transport and verify connectivity.
  /// Idempotent - safe to call multiple times.
  /// </summary>
  Task InitializeAsync(CancellationToken cancellationToken = default);

  /// <summary>
  /// Capabilities this transport supports.
  /// </summary>
  TransportCapabilities Capabilities { get; }

  /// <summary>
  /// Maximum per-message wire size in bytes; null means no enforced limit.
  /// Size-aware strategies (composite events, body offload) read this
  /// pre-flight to decide inline send vs. claim-check offload.
  /// Default implementation returns null.
  /// </summary>
  long? MaxMessageSizeBytes => null;

  /// <summary>
  /// Publish message (fire-and-forget).
  /// When preSerializedBytes is set, wire transports MUST use those bytes
  /// and skip their internal serialization.
  /// </summary>
  Task PublishAsync(
    IMessageEnvelope envelope,
    TransportDestination destination,
    string? envelopeType = null,
    ReadOnlyMemory<byte>? preSerializedBytes = null,
    CancellationToken cancellationToken = default
  );

  /// <summary>
  /// Subscribe with transport-level batch collection. The transport collects
  /// incoming messages into batches and invokes the handler once per batch
  /// (size reached, sliding window timeout, or hard max timeout).
  /// </summary>
  Task<ISubscription> SubscribeBatchAsync(
    Func<IReadOnlyList<TransportMessage>, CancellationToken, Task> batchHandler,
    TransportDestination destination,
    TransportBatchOptions batchOptions,
    CancellationToken cancellationToken = default
  );

  /// <summary>
  /// Push subscription on the broker's dead-letter queue/subqueue.
  /// Default implementation throws NotSupportedException; the
  /// TransportDeadLetterDrainWorker falls back to polling.
  /// </summary>
  Task<ISubscription> SubscribeToDeadLetterAsync(
    Func<TransportMessage, CancellationToken, Task> handler,
    TransportDestination destination,
    CancellationToken cancellationToken = default
  ) => throw new NotSupportedException(/* ... */);

  /// <summary>
  /// Send request and wait for response (request/response pattern).
  /// Only supported if Capabilities includes RequestResponse.
  /// </summary>
  Task<IMessageEnvelope> SendAsync<TRequest, TResponse>(
    IMessageEnvelope requestEnvelope,
    TransportDestination destination,
    CancellationToken cancellationToken = default
  ) where TRequest : notnull where TResponse : notnull;

  /// <summary>
  /// Publish a batch of messages to the same destination in one operation.
  /// Default implementation throws NotSupportedException - check
  /// Capabilities.HasFlag(TransportCapabilities.BulkPublish) first.
  /// </summary>
  Task<IReadOnlyList<BulkPublishItemResult>> PublishBatchAsync(
    IReadOnlyList<BulkPublishItem> items,
    TransportDestination destination,
    CancellationToken cancellationToken = default
  ) => throw new NotSupportedException(/* ... */);
}
```

:::note
`SubscribeToDeadLetterAsync`, `PublishBatchAsync`, and `MaxMessageSizeBytes` have default interface implementations — a minimal custom transport only implements `IsInitialized`, `InitializeAsync`, `Capabilities`, `PublishAsync`, `SubscribeBatchAsync`, and `SendAsync`.
:::

### Transport Capabilities

```csharp{title="Transport Capabilities" description="Transport Capabilities" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Transport", "Capabilities"] tests=["TransportCapabilitiesTests.TransportCapabilities_HasNoneValueAsync", "TransportCapabilitiesTests.TransportCapabilities_HasBulkPublishAsync", "TransportCapabilitiesTests.TransportCapabilities_AllFlag_ContainsAllCapabilitiesAsync", "TransportCapabilitiesTests.TransportCapabilities_CanCombineFlagsAsync"]}
[Flags]
public enum TransportCapabilities {
  None = 0,
  RequestResponse = 1 << 0,    // Send/Receive (HTTP, gRPC)
  PublishSubscribe = 1 << 1,   // Pub/Sub (Kafka, Service Bus)
  Streaming = 1 << 2,          // IAsyncEnumerable streaming
  Reliable = 1 << 3,           // At-least-once delivery
  Ordered = 1 << 4,            // FIFO ordering within a stream/partition
  ExactlyOnce = 1 << 5,        // Exactly-once semantics (requires Inbox/Outbox dedup)
  BulkPublish = 1 << 6,        // Multiple messages in a single transport operation
  All = RequestResponse | PublishSubscribe | Streaming | Reliable | Ordered | ExactlyOnce | BulkPublish
}
```

**Example Capability Declarations**:

| Transport | Capabilities |
|-----------|-------------|
| **HTTP** (custom) | `RequestResponse` |
| **gRPC** (custom) | `RequestResponse \| Streaming` |
| **Kafka** (custom) | `PublishSubscribe \| Reliable \| Ordered` |
| **In-Process** (built-in) | `RequestResponse \| PublishSubscribe \| Ordered \| Reliable` |
| **RabbitMQ** (built-in) | `PublishSubscribe \| Reliable \| BulkPublish` (+ `Ordered` when single-active-consumer is enabled) |
| **Azure Service Bus** (built-in) | `PublishSubscribe \| Reliable \| BulkPublish` (+ `Ordered` when sessions are enabled) |

---

## HTTP Transport Implementation

### Pattern 1: HTTP Client Transport

**Use Case**: Call remote HTTP APIs using Whizbang message patterns.

```csharp{title="Pattern 1: HTTP Client Transport" description="Use Case: Call remote HTTP APIs using Whizbang message patterns." category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "HTTP"] unverified="user extension example — custom ITransport implementation"}
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
    string? envelopeType = null,
    ReadOnlyMemory<byte>? preSerializedBytes = null,
    CancellationToken cancellationToken = default
  ) {
    throw new NotSupportedException("HTTP transport does not support publish (use SendAsync instead)");
  }

  public Task<ISubscription> SubscribeBatchAsync(
    Func<IReadOnlyList<TransportMessage>, CancellationToken, Task> batchHandler,
    TransportDestination destination,
    TransportBatchOptions batchOptions,
    CancellationToken cancellationToken = default
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
```csharp{title="Pattern 1: HTTP Client Transport (2)" description="Registration:" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Pattern", "HTTP"] unverified="user extension example — DI registration for a custom transport"}
builder.Services.AddHttpClient<HttpTransport>(client => {
  client.BaseAddress = new Uri("https://api.example.com");
  client.Timeout = TimeSpan.FromSeconds(30);
});

builder.Services.AddSingleton<ITransport, HttpTransport>();
```

**Usage**:
```csharp{title="Pattern 1: HTTP Client Transport (3)" description="Pattern 1: HTTP Client Transport" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Pattern", "HTTP"] unverified="user extension example — usage of a custom transport"}
var request = new MessageEnvelope<CreateOrder> {
  MessageId = MessageId.New(),
  DispatchContext = new MessageDispatchContext {
    Mode = DispatchModes.Local,
    Source = MessageSource.Local
  },
  Payload = new CreateOrder(orderId, customerId, items),
  Hops = [
    new MessageHop {
      ServiceInstance = new ServiceInstanceInfo {
        ServiceName = "order-api",
        InstanceId = Guid.NewGuid(),
        HostName = Environment.MachineName,
        ProcessId = Environment.ProcessId
      },
      CorrelationId = CorrelationId.New()
    }
  ]
};

var destination = new TransportDestination(Address: "/orders/create");

var response = await transport.SendAsync<CreateOrder, OrderCreated>(request, destination);
```

---

## gRPC Transport Implementation

### Pattern 2: gRPC Channel Transport

**Use Case**: High-performance RPC with streaming support.

```csharp{title="Pattern 2: gRPC Channel Transport" description="Use Case: High-performance RPC with streaming support." category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "GRPC"] unverified="user extension example — custom ITransport implementation"}
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
    string? envelopeType = null,
    ReadOnlyMemory<byte>? preSerializedBytes = null,
    CancellationToken cancellationToken = default
  ) {
    throw new NotSupportedException("gRPC transport is request/response only (use streaming for pub/sub)");
  }

  public Task<ISubscription> SubscribeBatchAsync(
    Func<IReadOnlyList<TransportMessage>, CancellationToken, Task> batchHandler,
    TransportDestination destination,
    TransportBatchOptions batchOptions,
    CancellationToken cancellationToken = default
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

```csharp{title="Pattern 3: Kafka Producer/Consumer Transport" description="Use Case: High-throughput event streaming with ordering and persistence." category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Kafka"] unverified="user extension example — custom ITransport implementation"}
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
    string? envelopeType = null,
    ReadOnlyMemory<byte>? preSerializedBytes = null,
    CancellationToken ct = default
  ) {
    // Honor the pre-serialized bytes hint when upstream already serialized once
    string json;
    var clrEnvelopeType = envelope.GetType();
    var typeName = envelopeType ?? clrEnvelopeType.AssemblyQualifiedName!;

    if (preSerializedBytes is { } bytes) {
      json = System.Text.Encoding.UTF8.GetString(bytes.Span);
    } else {
      var typeInfo = _jsonOptions.GetTypeInfo(clrEnvelopeType)
        ?? throw new InvalidOperationException($"No JsonTypeInfo for {clrEnvelopeType.Name}");
      json = JsonSerializer.Serialize(envelope, typeInfo);
    }

    // Create Kafka message
    var message = new Message<string, string> {
      Key = envelope.GetCurrentStreamId() ?? envelope.MessageId.Value.ToString(),  // Partition by stream
      Value = json,
      Headers = new Headers {
        { "MessageId", System.Text.Encoding.UTF8.GetBytes(envelope.MessageId.Value.ToString()) },
        { "CorrelationId", System.Text.Encoding.UTF8.GetBytes(envelope.GetCorrelationId()?.ToString() ?? "") },
        { "EnvelopeType", System.Text.Encoding.UTF8.GetBytes(typeName) }
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

  public Task<ISubscription> SubscribeBatchAsync(
    Func<IReadOnlyList<TransportMessage>, CancellationToken, Task> batchHandler,
    TransportDestination destination,
    TransportBatchOptions batchOptions,
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

    // Background task to consume messages in batches
    var consumeTask = Task.Run(async () => {
      var batch = new List<TransportMessage>(batchOptions.BatchSize);
      var results = new List<ConsumeResult<string, string>>(batchOptions.BatchSize);

      try {
        while (!ct.IsCancellationRequested) {
          // Collect a batch: flush on size, or on SlideMs of no new messages
          // (production code also honors MaxWaitMs as a hard ceiling)
          var consumeResult = consumer.Consume(TimeSpan.FromMilliseconds(batchOptions.SlideMs));

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

              batch.Add(new TransportMessage(envelope, envelopeTypeName));
              results.Add(consumeResult);

            } catch (Exception ex) {
              _logger.LogError(
                ex,
                "Error deserializing Kafka message from topic {Topic}, partition {Partition}, offset {Offset}",
                consumeResult.Topic,
                consumeResult.Partition.Value,
                consumeResult.Offset.Value
              );
              // Don't commit - message will be retried
            }
          }

          // Flush when batch is full, or when the sliding window elapsed with a partial batch
          var windowElapsed = consumeResult?.Message == null && batch.Count > 0;
          if (batch.Count >= batchOptions.BatchSize || windowElapsed) {
            // Invoke batch handler once per batch
            await batchHandler(batch, ct);

            // Commit offsets after successful batch processing
            foreach (var result in results) {
              consumer.Commit(result);
            }

            _logger.LogDebug("Processed Kafka batch of {Count} messages", batch.Count);
            batch.Clear();
            results.Clear();
          }
        }
      } catch (OperationCanceledException) {
        // Expected on shutdown
      } finally {
        consumer.Close();
      }
    }, ct);

    return Task.FromResult<ISubscription>(new KafkaSubscription(consumer, consumeTask));
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
/// ISubscription is IDisposable with pause/resume control and an
/// OnDisconnected event for reconnection triggers.
/// </summary>
internal class KafkaSubscription : ISubscription {
  private readonly IConsumer<string, string> _consumer;
  private readonly Task _consumeTask;
  private volatile bool _isActive = true;
  private bool _disposed;

  public KafkaSubscription(IConsumer<string, string> consumer, Task consumeTask) {
    _consumer = consumer;
    _consumeTask = consumeTask;
  }

  public event EventHandler<SubscriptionDisconnectedEventArgs>? OnDisconnected;

  public bool IsActive => _isActive;

  public Task PauseAsync() {
    // Pause delivery (e.g., consumer.Pause(consumer.Assignment))
    _isActive = false;
    return Task.CompletedTask;
  }

  public Task ResumeAsync() {
    // Resume delivery (e.g., consumer.Resume(consumer.Assignment))
    _isActive = true;
    return Task.CompletedTask;
  }

  public void Dispose() {
    if (_disposed) return;
    _disposed = true;

    // Stop consuming and leave the group
    _consumer.Close();
    _consumer.Dispose();

    OnDisconnected?.Invoke(this, new SubscriptionDisconnectedEventArgs {
      Reason = "Disposed",
      IsApplicationInitiated = true
    });
  }
}
```

**Registration**:
```csharp{title="Pattern 3: Kafka Producer/Consumer Transport (2)" description="Registration:" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Kafka"] unverified="user extension example — DI registration for a custom transport"}
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

```csharp{title="Pattern 4: Transport with Health Checks" description="Pattern 4: Transport with Health Checks" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Transport"] unverified="user extension example — custom health check for a custom transport"}
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

```csharp{title="Pattern 5: Batching Transport (High Throughput)" description="Pattern 5: Batching Transport (High Throughput)" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Batching"] unverified="user extension example — custom ITransport implementation"}
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
    string? envelopeType = null,
    ReadOnlyMemory<byte>? preSerializedBytes = null,
    CancellationToken cancellationToken = default
  ) {
    // Queue message for batching
    await _queue.Writer.WriteAsync((envelope, destination), cancellationToken);
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
  public Task<ISubscription> SubscribeBatchAsync(
    Func<IReadOnlyList<TransportMessage>, CancellationToken, Task> batchHandler,
    TransportDestination destination,
    TransportBatchOptions batchOptions,
    CancellationToken cancellationToken = default
  ) => _innerTransport.SubscribeBatchAsync(batchHandler, destination, batchOptions, cancellationToken);

  public Task<IMessageEnvelope> SendAsync<TRequest, TResponse>(
    IMessageEnvelope requestEnvelope,
    TransportDestination destination,
    CancellationToken cancellationToken = default
  ) where TRequest : notnull where TResponse : notnull =>
    _innerTransport.SendAsync<TRequest, TResponse>(requestEnvelope, destination, cancellationToken);
}
```

:::note
If the underlying broker supports batched sends natively, prefer declaring the `TransportCapabilities.BulkPublish` capability and implementing `PublishBatchAsync` instead of a wrapper — that is how the built-in RabbitMQ and Azure Service Bus transports batch outbox publishes.
:::

**Usage**:
```csharp{title="Pattern 5: Batching Transport (High Throughput) (2)" description="Pattern 5: Batching Transport (High Throughput)" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Pattern", "Batching"] unverified="user extension example — usage of a custom transport"}
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

```csharp{title="Testing Initialization" description="Testing Initialization" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Testing", "Initialization"] unverified="user extension example — tests a custom transport implementation"}
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

```csharp{title="Testing Publish/Subscribe" description="Testing Publish/Subscribe" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Testing", "Publish"] unverified="user extension example — tests a custom transport implementation"}
public class KafkaTransportIntegrationTests {
  [Test]
  public async Task PublishAndSubscribe_MessageReceivedAsync() {
    // Arrange
    var transport = CreateKafkaTransport();
    await transport.InitializeAsync();

    var receivedEnvelope = default(IMessageEnvelope);
    var messageReceived = new TaskCompletionSource<bool>();

    var destination = new TransportDestination(Address: "test-topic");

    // Subscribe (batch handler - invoked once per batch, not per message)
    await transport.SubscribeBatchAsync(
      batchHandler: (batch, ct) => {
        receivedEnvelope = batch[0].Envelope;
        messageReceived.SetResult(true);
        return Task.CompletedTask;
      },
      destination: destination,
      batchOptions: new TransportBatchOptions { BatchSize = 1 }
    );

    // Act - Publish
    var envelope = new MessageEnvelope<TestMessage> {
      MessageId = MessageId.New(),
      DispatchContext = new MessageDispatchContext {
        Mode = DispatchModes.Local,
        Source = MessageSource.Local
      },
      Payload = new TestMessage("Hello Kafka!"),
      Hops = [
        new MessageHop {
          ServiceInstance = new ServiceInstanceInfo {
            ServiceName = "test",
            InstanceId = Guid.NewGuid(),
            HostName = "test-host",
            ProcessId = Environment.ProcessId
          },
          CorrelationId = CorrelationId.New()
        }
      ]
    };

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
- [Azure Service Bus](../../messaging/transports/azure-service-bus.md) - Built-in Service Bus transport
- [In-Memory](../../messaging/transports/in-memory.md) - Testing transport

**Messaging**:
- [Outbox Pattern](../../messaging/outbox-pattern.md) - Reliable event publishing
- [Work Coordination](../../messaging/work-coordination.md) - Lease-based processing

**Source Generators**:
- [JSON Contexts](../source-generators/json-contexts.md) - AOT-compatible serialization

**Infrastructure**:
- [Health Checks](../../operations/infrastructure/health-checks.md) - Transport health monitoring

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
