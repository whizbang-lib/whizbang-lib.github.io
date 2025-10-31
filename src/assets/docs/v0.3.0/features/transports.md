---
title: Message Queue Transports
version: 0.3.0
category: Features
order: 5
evolves-from: v0.2.0/enhancements/transports.md
evolves-to: v0.4.0/streaming/transports.md, v0.5.0/production/transports.md
description: Enterprise messaging with RabbitMQ, Kafka, and Redis pub/sub
tags: transports, messaging, rabbitmq, kafka, redis, pubsub, queues, v0.3.0
---

# Message Queue Transports

![Version](https://img.shields.io/badge/version-0.3.0-blue)
![Status](https://img.shields.io/badge/status-feature-orange)
![Next Update](https://img.shields.io/badge/next-v0.4.0-yellow)

## Version History

:::updated
**Enhanced in v0.3.0**: 
- RabbitMQ transport with exchanges and routing
- Apache Kafka transport for event streaming
- Redis pub/sub for lightweight messaging
- Dead letter queues and poison message handling
- Message persistence and durability
:::

:::planned
**Coming in v0.4.0**: 
- gRPC transport with streaming
- GraphQL subscriptions
- Server-Sent Events (SSE)

[See streaming features →](../../v0.4.0/streaming/transports.md)
:::

:::planned
**Coming in v0.5.0**: 
- Cloud-native transports (SQS, Service Bus, Pub/Sub)
- Multi-cloud federation
- Global message routing

[See production features →](../../v0.5.0/production/transports.md)
:::

## Message Queue Architecture

### RabbitMQ Transport

:::new
Full RabbitMQ support with advanced routing:
:::

```csharp
[WhizbangTransport("RabbitMQ")]
public class RabbitMQTransport : ITransport, IReliableTransport {
    private readonly IConnection _connection;
    private readonly IModel _channel;
    private readonly RabbitMQOptions _options;
    private readonly ISerializer _serializer;
    
    public string Name => "RabbitMQ";
    public TransportCapabilities Capabilities => 
        TransportCapabilities.PublishSubscribe |
        TransportCapabilities.Reliable |
        TransportCapabilities.Ordered;
    
    public RabbitMQTransport(RabbitMQOptions options) {
        _options = options;
        _serializer = new MessagePackSerializer();
        
        var factory = new ConnectionFactory {
            Uri = new Uri(options.ConnectionString),
            AutomaticRecoveryEnabled = true,
            NetworkRecoveryInterval = TimeSpan.FromSeconds(10),
            RequestedHeartbeat = TimeSpan.FromSeconds(60),
            DispatchConsumersAsync = true
        };
        
        _connection = factory.CreateConnection($"Whizbang-{Environment.MachineName}");
        _channel = _connection.CreateModel();
        
        // Configure channel
        _channel.BasicQos(prefetchSize: 0, prefetchCount: options.PrefetchCount, global: false);
        
        // Declare exchanges
        DeclareExchanges();
    }
    
    private void DeclareExchanges() {
        // Topic exchange for pub/sub
        _channel.ExchangeDeclare(
            exchange: $"{_options.ExchangePrefix}.events",
            type: ExchangeType.Topic,
            durable: true,
            autoDelete: false
        );
        
        // Direct exchange for commands
        _channel.ExchangeDeclare(
            exchange: $"{_options.ExchangePrefix}.commands",
            type: ExchangeType.Direct,
            durable: true,
            autoDelete: false
        );
        
        // Headers exchange for complex routing
        _channel.ExchangeDeclare(
            exchange: $"{_options.ExchangePrefix}.headers",
            type: ExchangeType.Headers,
            durable: true,
            autoDelete: false
        );
        
        // Dead letter exchange
        _channel.ExchangeDeclare(
            exchange: $"{_options.ExchangePrefix}.dlx",
            type: ExchangeType.Fanout,
            durable: true,
            autoDelete: false
        );
    }
    
    public async Task<TResponse> Send<TRequest, TResponse>(
        TRequest request, 
        string destination)
        where TRequest : IMessage
        where TResponse : IMessage {
        
        // Create temporary reply queue
        var replyQueue = _channel.QueueDeclare(
            queue: "",
            durable: false,
            exclusive: true,
            autoDelete: true
        ).QueueName;
        
        var correlationId = Guid.NewGuid().ToString();
        var tcs = new TaskCompletionSource<TResponse>();
        
        // Setup consumer for reply
        var consumer = new AsyncEventingBasicConsumer(_channel);
        consumer.Received += async (sender, ea) => {
            if (ea.BasicProperties.CorrelationId == correlationId) {
                var response = _serializer.Deserialize<TResponse>(ea.Body.ToArray());
                tcs.SetResult(response);
            }
        };
        
        _channel.BasicConsume(replyQueue, autoAck: true, consumer);
        
        // Send request
        var properties = _channel.CreateBasicProperties();
        properties.CorrelationId = correlationId;
        properties.ReplyTo = replyQueue;
        properties.Persistent = _options.PersistentMessages;
        properties.Expiration = _options.MessageTTL?.TotalMilliseconds.ToString();
        properties.Headers = ConvertHeaders(request.Headers);
        
        var body = _serializer.Serialize(request);
        
        _channel.BasicPublish(
            exchange: $"{_options.ExchangePrefix}.commands",
            routingKey: destination,
            basicProperties: properties,
            body: body
        );
        
        // Wait for response with timeout
        using var cts = new CancellationTokenSource(_options.RequestTimeout);
        cts.Token.Register(() => tcs.TrySetCanceled());
        
        return await tcs.Task;
    }
    
    public async Task Publish<TMessage>(TMessage message, string topic)
        where TMessage : IMessage {
        
        var properties = _channel.CreateBasicProperties();
        properties.Persistent = _options.PersistentMessages;
        properties.MessageId = message.Id.ToString();
        properties.Timestamp = new AmqpTimestamp(DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        properties.Type = typeof(TMessage).FullName;
        properties.Headers = ConvertHeaders(message.Headers);
        
        var body = _serializer.Serialize(message);
        
        _channel.BasicPublish(
            exchange: $"{_options.ExchangePrefix}.events",
            routingKey: topic,
            basicProperties: properties,
            body: body
        );
        
        await Task.CompletedTask;
    }
    
    public async Task Subscribe<TMessage>(string topic, Func<TMessage, Task> handler)
        where TMessage : IMessage {
        
        // Declare queue for subscription
        var queueName = $"{_options.QueuePrefix}.{typeof(TMessage).Name}.{Guid.NewGuid():N}";
        
        _channel.QueueDeclare(
            queue: queueName,
            durable: _options.DurableQueues,
            exclusive: false,
            autoDelete: true,
            arguments: new Dictionary<string, object> {
                ["x-dead-letter-exchange"] = $"{_options.ExchangePrefix}.dlx",
                ["x-message-ttl"] = _options.MessageTTL?.TotalMilliseconds ?? 86400000,
                ["x-max-length"] = _options.MaxQueueLength ?? 10000
            }
        );
        
        // Bind to topic
        _channel.QueueBind(
            queue: queueName,
            exchange: $"{_options.ExchangePrefix}.events",
            routingKey: topic
        );
        
        // Create consumer
        var consumer = new AsyncEventingBasicConsumer(_channel);
        consumer.Received += async (sender, ea) => {
            try {
                var message = _serializer.Deserialize<TMessage>(ea.Body.ToArray());
                await handler(message);
                
                // Acknowledge message
                _channel.BasicAck(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex) {
                _logger.LogError(ex, "Failed to process message");
                
                // Reject and send to DLQ
                _channel.BasicNack(ea.DeliveryTag, multiple: false, requeue: false);
            }
        };
        
        _channel.BasicConsume(
            queue: queueName,
            autoAck: false,
            consumer: consumer
        );
        
        await Task.CompletedTask;
    }
}
```

### Kafka Transport

:::new
Apache Kafka for high-throughput event streaming:
:::

```csharp
[WhizbangTransport("Kafka")]
public class KafkaTransport : ITransport, IStreamingTransport {
    private readonly IProducer<string, byte[]> _producer;
    private readonly Dictionary<string, IConsumer<string, byte[]>> _consumers;
    private readonly KafkaOptions _options;
    private readonly ISerializer _serializer;
    
    public string Name => "Kafka";
    public TransportCapabilities Capabilities => 
        TransportCapabilities.PublishSubscribe |
        TransportCapabilities.Streaming |
        TransportCapabilities.Ordered |
        TransportCapabilities.Reliable;
    
    public KafkaTransport(KafkaOptions options) {
        _options = options;
        _serializer = new AvroSerializer(options.SchemaRegistry);
        _consumers = new Dictionary<string, IConsumer<string, byte[]>>();
        
        // Configure producer
        var producerConfig = new ProducerConfig {
            BootstrapServers = options.BootstrapServers,
            Acks = options.Acks,
            EnableIdempotence = true,
            MaxInFlight = 5,
            CompressionType = CompressionType.Snappy,
            LingerMs = 10,
            BatchSize = 16384,
            RetryBackoffMs = 100,
            MessageSendMaxRetries = 3
        };
        
        _producer = new ProducerBuilder<string, byte[]>(producerConfig)
            .SetErrorHandler((_, e) => _logger.LogError($"Kafka error: {e.Reason}"))
            .SetStatisticsHandler((_, json) => _logger.LogDebug($"Kafka stats: {json}"))
            .Build();
    }
    
    public async Task Publish<TMessage>(TMessage message, string topic)
        where TMessage : IMessage {
        
        var headers = new Headers();
        foreach (var header in message.Headers) {
            headers.Add(header.Key, Encoding.UTF8.GetBytes(header.Value));
        }
        
        var kafkaMessage = new Message<string, byte[]> {
            Key = message.Id.ToString(),
            Value = await _serializer.SerializeAsync(message),
            Headers = headers,
            Timestamp = new Timestamp(DateTimeOffset.UtcNow)
        };
        
        var result = await _producer.ProduceAsync(topic, kafkaMessage);
        
        if (result.Status != PersistenceStatus.Persisted) {
            throw new TransportException($"Failed to publish to Kafka: {result.Status}");
        }
    }
    
    public async Task Subscribe<TMessage>(string topic, Func<TMessage, Task> handler)
        where TMessage : IMessage {
        
        var consumerConfig = new ConsumerConfig {
            BootstrapServers = _options.BootstrapServers,
            GroupId = $"{_options.ConsumerGroupPrefix}.{typeof(TMessage).Name}",
            AutoOffsetReset = AutoOffsetReset.Earliest,
            EnableAutoCommit = false,
            EnablePartitionEof = false,
            MaxPollIntervalMs = 300000,
            SessionTimeoutMs = 10000,
            IsolationLevel = IsolationLevel.ReadCommitted
        };
        
        var consumer = new ConsumerBuilder<string, byte[]>(consumerConfig)
            .SetErrorHandler((_, e) => _logger.LogError($"Consumer error: {e.Reason}"))
            .SetPartitionsAssignedHandler((c, partitions) => {
                _logger.LogInformation($"Assigned partitions: {string.Join(", ", partitions)}");
            })
            .Build();
        
        consumer.Subscribe(topic);
        _consumers[topic] = consumer;
        
        // Start consumption loop
        _ = Task.Run(async () => {
            while (!_cancellationToken.IsCancellationRequested) {
                try {
                    var result = consumer.Consume(_cancellationToken);
                    
                    var message = await _serializer.DeserializeAsync<TMessage>(result.Message.Value);
                    
                    // Add headers to message
                    foreach (var header in result.Message.Headers) {
                        message.Headers[header.Key] = Encoding.UTF8.GetString(header.GetValueBytes());
                    }
                    
                    await handler(message);
                    
                    // Commit offset after successful processing
                    consumer.Commit(result);
                }
                catch (ConsumeException ex) {
                    _logger.LogError(ex, "Kafka consume error");
                }
            }
        });
        
        await Task.CompletedTask;
    }
    
    // Stream processing API
    public IAsyncEnumerable<TMessage> Stream<TMessage>(string topic, CancellationToken ct)
        where TMessage : IMessage {
        
        return new KafkaStream<TMessage>(
            CreateConsumer(topic),
            _serializer,
            ct
        );
    }
}
```

### Redis Pub/Sub Transport

:::new
Lightweight pub/sub with Redis:
:::

```csharp
[WhizbangTransport("Redis")]
public class RedisTransport : ITransport {
    private readonly IConnectionMultiplexer _redis;
    private readonly ISubscriber _subscriber;
    private readonly RedisOptions _options;
    private readonly ISerializer _serializer;
    
    public string Name => "Redis";
    public TransportCapabilities Capabilities => 
        TransportCapabilities.PublishSubscribe;
    
    public RedisTransport(RedisOptions options) {
        _options = options;
        _serializer = new JsonSerializer();
        
        var config = ConfigurationOptions.Parse(options.ConnectionString);
        config.AbortOnConnectFail = false;
        config.ReconnectRetryPolicy = new ExponentialRetry(5000);
        
        _redis = ConnectionMultiplexer.Connect(config);
        _subscriber = _redis.GetSubscriber();
    }
    
    public async Task Publish<TMessage>(TMessage message, string topic)
        where TMessage : IMessage {
        
        var channel = new RedisChannel($"{_options.ChannelPrefix}:{topic}", 
            RedisChannel.PatternMode.Literal);
        
        var envelope = new RedisMessageEnvelope {
            MessageId = message.Id,
            MessageType = typeof(TMessage).FullName,
            Timestamp = DateTimeOffset.UtcNow,
            Headers = message.Headers,
            Body = _serializer.Serialize(message)
        };
        
        var json = JsonSerializer.Serialize(envelope);
        await _subscriber.PublishAsync(channel, json);
    }
    
    public async Task Subscribe<TMessage>(string topic, Func<TMessage, Task> handler)
        where TMessage : IMessage {
        
        var channel = new RedisChannel($"{_options.ChannelPrefix}:{topic}",
            RedisChannel.PatternMode.Literal);
        
        await _subscriber.SubscribeAsync(channel, async (ch, value) => {
            try {
                var envelope = JsonSerializer.Deserialize<RedisMessageEnvelope>(value!);
                var message = _serializer.Deserialize<TMessage>(envelope.Body);
                
                // Restore headers
                foreach (var header in envelope.Headers) {
                    message.Headers[header.Key] = header.Value;
                }
                
                await handler(message);
            }
            catch (Exception ex) {
                _logger.LogError(ex, "Failed to process Redis message");
            }
        });
    }
}
```

## Dead Letter Queue Handling

### Poison Message Processing

```csharp
public class DeadLetterQueueProcessor {
    private readonly ITransport _transport;
    private readonly IDeadLetterStore _dlqStore;
    
    public async Task ProcessDeadLetters(string queue) {
        await foreach (var deadLetter in _dlqStore.ReadDeadLetters(queue)) {
            try {
                // Analyze failure reason
                var analysis = AnalyzeFailure(deadLetter);
                
                if (analysis.CanRetry) {
                    // Attempt reprocessing
                    await ReprocessMessage(deadLetter);
                } else if (analysis.RequiresManualIntervention) {
                    // Alert operations team
                    await AlertOperations(deadLetter, analysis);
                } else {
                    // Archive permanently
                    await ArchiveMessage(deadLetter);
                }
            }
            catch (Exception ex) {
                _logger.LogError(ex, "Failed to process dead letter");
            }
        }
    }
    
    private FailureAnalysis AnalyzeFailure(DeadLetter deadLetter) {
        // Check failure patterns
        if (deadLetter.Exception.Contains("Timeout")) {
            return new FailureAnalysis { 
                CanRetry = true, 
                RetryDelay = TimeSpan.FromMinutes(5) 
            };
        }
        
        if (deadLetter.Exception.Contains("ValidationException")) {
            return new FailureAnalysis { 
                CanRetry = false,
                RequiresManualIntervention = true
            };
        }
        
        return new FailureAnalysis { CanRetry = false };
    }
}
```

## Message Patterns

### Competing Consumers

```csharp
public class CompetingConsumerSetup {
    public void ConfigureCompetingConsumers(ITransport transport) {
        // All consumers in same group compete for messages
        var consumerGroup = "order-processors";
        
        for (int i = 0; i < 5; i++) {
            transport.Subscribe<ProcessOrderCommand>(
                topic: "orders.process",
                handler: async cmd => await ProcessOrder(cmd),
                options: new SubscriptionOptions {
                    ConsumerGroup = consumerGroup,
                    MaxConcurrency = 10
                }
            );
        }
    }
}
```

### Saga Pattern

```csharp
public class OrderSaga {
    private readonly ITransport _transport;
    
    public async Task StartSaga(CreateOrderCommand command) {
        var sagaId = Guid.NewGuid();
        
        // Step 1: Reserve inventory
        await _transport.Publish(new ReserveInventoryCommand {
            SagaId = sagaId,
            Items = command.Items
        }, "inventory.reserve");
        
        // Step 2: Process payment
        await _transport.Subscribe<InventoryReservedEvent>(
            $"saga.{sagaId}",
            async evt => {
                await _transport.Publish(new ProcessPaymentCommand {
                    SagaId = sagaId,
                    Amount = command.Total
                }, "payment.process");
            }
        );
        
        // Step 3: Complete or compensate
        await _transport.Subscribe<PaymentProcessedEvent>(
            $"saga.{sagaId}",
            async evt => await CompleteSaga(sagaId)
        );
        
        await _transport.Subscribe<PaymentFailedEvent>(
            $"saga.{sagaId}",
            async evt => await CompensateSaga(sagaId)
        );
    }
}
```

## Testing Message Queues

```csharp
[Test]
public class MessageQueueTests {
    [Test]
    public async Task RabbitMQ_ShouldDeliverInOrder() {
        // Arrange
        var transport = new RabbitMQTransport(new RabbitMQOptions {
            ConnectionString = "amqp://localhost"
        });
        
        var received = new List<int>();
        await transport.Subscribe<TestMessage>("test.ordered", async msg => {
            received.Add(msg.Sequence);
        });
        
        // Act
        for (int i = 1; i <= 10; i++) {
            await transport.Publish(new TestMessage { Sequence = i }, "test.ordered");
        }
        
        await Task.Delay(1000); // Wait for delivery
        
        // Assert
        Assert.That(received, Is.EqualTo(Enumerable.Range(1, 10)));
    }
}
```

## Performance Characteristics

| Transport | Throughput | Latency | Durability | Ordering |
|-----------|------------|---------|------------|----------|
| RabbitMQ | 50K msg/s | < 5ms | Yes | Yes |
| Kafka | 1M msg/s | < 10ms | Yes | Per partition |
| Redis | 100K msg/s | < 1ms | No | No |

## Migration from v0.2.0

### Adding Queue Support

```csharp
// v0.2.0 - HTTP only
services.AddWhizbangTransports(options => {
    options.UseHttp(http => { });
});

// v0.3.0 - Add message queues
services.AddWhizbangTransports(options => {
    options.UseHttp(http => { });  // Keep HTTP
    
    options.UseRabbitMQ(rabbit => {  // Add RabbitMQ
        rabbit.ConnectionString = "amqp://localhost";
    });
    
    options.UseKafka(kafka => {  // Add Kafka
        kafka.BootstrapServers = "localhost:9092";
    });
});
```

## Related Documentation

- [v0.2.0 HTTP/WebSocket](../../v0.2.0/enhancements/transports.md) - Network transports
- [v0.5.0 Cloud](../../v0.5.0/production/transports.md) - Cloud-native transports
- [Messaging Patterns](../guides/messaging-patterns.md) - Common patterns
- [Queue Selection](../guides/queue-selection.md) - Choosing the right queue