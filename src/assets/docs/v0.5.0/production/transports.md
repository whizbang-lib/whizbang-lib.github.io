---
title: Cloud-Native Transports
version: 0.5.0
category: Production
order: 6
evolves-from: v0.3.0/features/transports.md, v0.4.0/streaming/transports.md
description: Multi-cloud messaging with AWS SQS/SNS, Azure Service Bus, Google Pub/Sub, and global federation
tags: transports, cloud, aws, azure, gcp, federation, multi-cloud, production, v0.5.0
---

# Cloud-Native Transports

![Version](https://img.shields.io/badge/version-0.5.0-blue)
![Status](https://img.shields.io/badge/status-production-green)

## Version History

:::updated
**Production-ready in v0.5.0**: 
- AWS SQS/SNS transport with FIFO support
- Azure Service Bus with sessions and transactions
- Google Cloud Pub/Sub with ordering keys
- Multi-cloud message federation
- Global routing and failover
:::

## Cloud Provider Transports

### AWS SQS/SNS Transport

:::new
Fully managed AWS messaging with auto-scaling:
:::

```csharp
[WhizbangTransport("AWS")]
public class AWSTransport : ITransport, ICloudTransport {
    private readonly IAmazonSQS _sqsClient;
    private readonly IAmazonSNS _snsClient;
    private readonly AWSTransportOptions _options;
    private readonly ISerializer _serializer;
    private readonly Dictionary<string, string> _queueUrls;
    private readonly Dictionary<string, string> _topicArns;
    
    public string Name => "AWS";
    public TransportCapabilities Capabilities => 
        TransportCapabilities.RequestResponse |
        TransportCapabilities.PublishSubscribe |
        TransportCapabilities.Reliable |
        TransportCapabilities.Ordered |
        TransportCapabilities.CloudNative;
    
    public AWSTransport(AWSTransportOptions options) {
        _options = options;
        _serializer = new CloudEventSerializer();
        _queueUrls = new ConcurrentDictionary<string, string>();
        _topicArns = new ConcurrentDictionary<string, string>();
        
        var config = new AmazonSQSConfig {
            RegionEndpoint = RegionEndpoint.GetBySystemName(options.Region),
            MaxErrorRetry = 3,
            Timeout = TimeSpan.FromSeconds(30)
        };
        
        _sqsClient = new AmazonSQSClient(config);
        _snsClient = new AmazonSNSClient(config);
        
        // Initialize resources
        InitializeResources().Wait();
    }
    
    private async Task InitializeResources() {
        // Create or get queues
        foreach (var queueConfig in _options.Queues) {
            var queueUrl = await EnsureQueue(queueConfig);
            _queueUrls[queueConfig.Name] = queueUrl;
        }
        
        // Create or get topics
        foreach (var topicConfig in _options.Topics) {
            var topicArn = await EnsureTopic(topicConfig);
            _topicArns[topicConfig.Name] = topicArn;
        }
    }
    
    private async Task<string> EnsureQueue(QueueConfig config) {
        var attributes = new Dictionary<string, string> {
            ["MessageRetentionPeriod"] = config.RetentionPeriod.TotalSeconds.ToString(),
            ["VisibilityTimeout"] = config.VisibilityTimeout.TotalSeconds.ToString(),
            ["ReceiveMessageWaitTimeSeconds"] = "20", // Long polling
        };
        
        if (config.IsFifo) {
            attributes["FifoQueue"] = "true";
            attributes["ContentBasedDeduplication"] = "true";
        }
        
        if (config.EnableDLQ) {
            // Create DLQ first
            var dlqUrl = await CreateDeadLetterQueue(config.Name);
            attributes["RedrivePolicy"] = JsonSerializer.Serialize(new {
                deadLetterTargetArn = GetQueueArn(dlqUrl),
                maxReceiveCount = config.MaxReceiveCount
            });
        }
        
        if (config.EnableEncryption) {
            attributes["KmsMasterKeyId"] = config.KmsKeyId ?? "alias/aws/sqs";
        }
        
        var request = new CreateQueueRequest {
            QueueName = config.IsFifo ? $"{config.Name}.fifo" : config.Name,
            Attributes = attributes,
            Tags = config.Tags
        };
        
        var response = await _sqsClient.CreateQueueAsync(request);
        return response.QueueUrl;
    }
    
    public async Task<TResponse> Send<TRequest, TResponse>(
        TRequest request, 
        string destination)
        where TRequest : IMessage
        where TResponse : IMessage {
        
        var queueUrl = _queueUrls[destination];
        var responseQueueUrl = await CreateTemporaryResponseQueue();
        
        try {
            // Send request with response queue info
            var messageBody = _serializer.Serialize(request);
            var sendRequest = new SendMessageRequest {
                QueueUrl = queueUrl,
                MessageBody = messageBody,
                MessageAttributes = new Dictionary<string, MessageAttributeValue> {
                    ["ResponseQueue"] = new() { 
                        DataType = "String", 
                        StringValue = responseQueueUrl 
                    },
                    ["CorrelationId"] = new() { 
                        DataType = "String", 
                        StringValue = request.Id.ToString() 
                    },
                    ["MessageType"] = new() { 
                        DataType = "String", 
                        StringValue = typeof(TRequest).FullName 
                    }
                }
            };
            
            if (queueUrl.EndsWith(".fifo")) {
                sendRequest.MessageGroupId = GetMessageGroupId(request);
                sendRequest.MessageDeduplicationId = request.Id.ToString();
            }
            
            await _sqsClient.SendMessageAsync(sendRequest);
            
            // Wait for response
            return await WaitForResponse<TResponse>(responseQueueUrl, request.Id);
        }
        finally {
            // Clean up temporary queue
            await _sqsClient.DeleteQueueAsync(responseQueueUrl);
        }
    }
    
    public async Task Publish<TMessage>(TMessage message, string topic)
        where TMessage : IMessage {
        
        var topicArn = _topicArns[topic];
        
        // Convert to CloudEvents format
        var cloudEvent = new CloudEvent {
            Id = message.Id.ToString(),
            Source = new Uri($"whizbang://{Environment.MachineName}"),
            Type = typeof(TMessage).FullName,
            Time = DateTimeOffset.UtcNow,
            Data = message,
            DataContentType = "application/json"
        };
        
        var publishRequest = new PublishRequest {
            TopicArn = topicArn,
            Message = JsonSerializer.Serialize(cloudEvent),
            MessageAttributes = ConvertToSNSAttributes(message.Headers)
        };
        
        if (topic.EndsWith(".fifo")) {
            publishRequest.MessageGroupId = GetMessageGroupId(message);
            publishRequest.MessageDeduplicationId = message.Id.ToString();
        }
        
        await _snsClient.PublishAsync(publishRequest);
    }
    
    public async Task Subscribe<TMessage>(string topic, Func<TMessage, Task> handler)
        where TMessage : IMessage {
        
        // Create SQS queue for subscription
        var queueName = $"{topic}-{typeof(TMessage).Name}-{Guid.NewGuid():N}";
        var queueUrl = await EnsureQueue(new QueueConfig { 
            Name = queueName,
            AutoDelete = true 
        });
        
        // Subscribe queue to SNS topic
        var topicArn = _topicArns[topic];
        await _snsClient.SubscribeAsync(new SubscribeRequest {
            Protocol = "sqs",
            TopicArn = topicArn,
            Endpoint = GetQueueArn(queueUrl),
            Attributes = new Dictionary<string, string> {
                ["RawMessageDelivery"] = "true"
            }
        });
        
        // Start polling
        _ = Task.Run(async () => {
            while (!_cancellationToken.IsCancellationRequested) {
                var receiveRequest = new ReceiveMessageRequest {
                    QueueUrl = queueUrl,
                    MaxNumberOfMessages = 10,
                    WaitTimeSeconds = 20,
                    MessageAttributeNames = new List<string> { "All" }
                };
                
                var response = await _sqsClient.ReceiveMessageAsync(receiveRequest);
                
                foreach (var sqsMessage in response.Messages) {
                    try {
                        var cloudEvent = JsonSerializer.Deserialize<CloudEvent>(sqsMessage.Body);
                        var message = (TMessage)cloudEvent.Data;
                        
                        await handler(message);
                        
                        // Delete message on success
                        await _sqsClient.DeleteMessageAsync(queueUrl, sqsMessage.ReceiptHandle);
                    }
                    catch (Exception ex) {
                        _logger.LogError(ex, "Failed to process SQS message");
                        // Message will be retried based on queue configuration
                    }
                }
            }
        });
    }
}
```

### Azure Service Bus Transport

:::new
Enterprise messaging with sessions and transactions:
:::

```csharp
[WhizbangTransport("AzureServiceBus")]
public class AzureServiceBusTransport : ITransport, ICloudTransport {
    private readonly ServiceBusClient _client;
    private readonly Dictionary<string, ServiceBusSender> _senders;
    private readonly Dictionary<string, ServiceBusProcessor> _processors;
    private readonly AzureServiceBusOptions _options;
    
    public AzureServiceBusTransport(AzureServiceBusOptions options) {
        _options = options;
        _senders = new ConcurrentDictionary<string, ServiceBusSender>();
        _processors = new ConcurrentDictionary<string, ServiceBusProcessor>();
        
        var clientOptions = new ServiceBusClientOptions {
            TransportType = ServiceBusTransportType.AmqpWebSockets,
            RetryOptions = new ServiceBusRetryOptions {
                Mode = ServiceBusRetryMode.Exponential,
                MaxRetries = 3,
                Delay = TimeSpan.FromSeconds(1),
                MaxDelay = TimeSpan.FromSeconds(30)
            }
        };
        
        _client = new ServiceBusClient(options.ConnectionString, clientOptions);
    }
    
    public async Task<TResponse> Send<TRequest, TResponse>(
        TRequest request, 
        string destination)
        where TRequest : IMessage
        where TResponse : IMessage {
        
        var sender = GetOrCreateSender(destination);
        
        var message = new ServiceBusMessage {
            Body = BinaryData.FromObjectAsJson(request),
            MessageId = request.Id.ToString(),
            CorrelationId = request.Id.ToString(),
            SessionId = GetSessionId(request),
            ContentType = "application/json",
            TimeToLive = _options.MessageTTL,
            ApplicationProperties = {
                ["MessageType"] = typeof(TRequest).FullName,
                ["ReplyTo"] = $"response-{request.Id}"
            }
        };
        
        // Add custom headers
        foreach (var header in request.Headers) {
            message.ApplicationProperties[header.Key] = header.Value;
        }
        
        // Use transaction if available
        if (Transaction.Current != null) {
            await sender.SendMessageAsync(message);
        } else {
            // Create new transaction
            using var ts = new TransactionScope(
                TransactionScopeAsyncFlowOption.Enabled);
            
            await sender.SendMessageAsync(message);
            ts.Complete();
        }
        
        // Wait for response
        return await WaitForSessionResponse<TResponse>(
            $"response-{request.Id}", 
            request.Id
        );
    }
    
    public async Task Subscribe<TMessage>(string topic, Func<TMessage, Task> handler)
        where TMessage : IMessage {
        
        var processor = _client.CreateProcessor(
            topic,
            new ServiceBusProcessorOptions {
                MaxConcurrentCalls = _options.MaxConcurrency,
                PrefetchCount = _options.PrefetchCount,
                AutoCompleteMessages = false,
                MaxAutoLockRenewalDuration = TimeSpan.FromMinutes(5),
                ReceiveMode = ServiceBusReceiveMode.PeekLock
            }
        );
        
        processor.ProcessMessageAsync += async args => {
            try {
                var message = args.Message.Body.ToObjectFromJson<TMessage>();
                
                // Restore headers
                foreach (var prop in args.Message.ApplicationProperties) {
                    message.Headers[prop.Key] = prop.Value?.ToString() ?? "";
                }
                
                await handler(message);
                
                // Complete message
                await args.CompleteMessageAsync(args.Message);
            }
            catch (Exception ex) {
                _logger.LogError(ex, "Failed to process Service Bus message");
                
                // Move to dead letter queue
                await args.DeadLetterMessageAsync(
                    args.Message,
                    deadLetterReason: ex.GetType().Name,
                    deadLetterErrorDescription: ex.Message
                );
            }
        };
        
        processor.ProcessErrorAsync += async args => {
            _logger.LogError(args.Exception, 
                "Service Bus processor error on {EntityPath}", 
                args.EntityPath);
        };
        
        await processor.StartProcessingAsync();
        _processors[topic] = processor;
    }
}
```

### Google Cloud Pub/Sub Transport

:::new
Global message distribution with Google Cloud:
:::

```csharp
[WhizbangTransport("GooglePubSub")]
public class GooglePubSubTransport : ITransport, ICloudTransport {
    private readonly PublisherServiceApiClient _publisher;
    private readonly SubscriberServiceApiClient _subscriber;
    private readonly GooglePubSubOptions _options;
    private readonly Dictionary<string, TopicName> _topics;
    private readonly Dictionary<string, SubscriptionName> _subscriptions;
    
    public async Task Publish<TMessage>(TMessage message, string topic)
        where TMessage : IMessage {
        
        var topicName = _topics[topic];
        
        var pubsubMessage = new PubsubMessage {
            Data = ByteString.CopyFrom(_serializer.Serialize(message)),
            OrderingKey = GetOrderingKey(message),
            Attributes = {
                ["messageType"] = typeof(TMessage).FullName,
                ["messageId"] = message.Id.ToString(),
                ["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()
            }
        };
        
        // Add headers as attributes
        foreach (var header in message.Headers) {
            pubsubMessage.Attributes[header.Key] = header.Value;
        }
        
        await _publisher.PublishAsync(topicName, new[] { pubsubMessage });
    }
    
    public async Task Subscribe<TMessage>(string topic, Func<TMessage, Task> handler)
        where TMessage : IMessage {
        
        var subscriptionName = await CreateSubscription(topic, typeof(TMessage).Name);
        
        var subscriber = await SubscriberClient.CreateAsync(subscriptionName);
        
        await subscriber.StartAsync(async (PubsubMessage msg, CancellationToken ct) => {
            try {
                var message = _serializer.Deserialize<TMessage>(msg.Data.ToByteArray());
                
                // Restore headers
                foreach (var attr in msg.Attributes) {
                    message.Headers[attr.Key] = attr.Value;
                }
                
                await handler(message);
                
                return SubscriberClient.Reply.Ack;
            }
            catch (Exception ex) {
                _logger.LogError(ex, "Failed to process Pub/Sub message");
                return SubscriberClient.Reply.Nack;
            }
        });
    }
}
```

## Multi-Cloud Federation

### Federated Transport Layer

:::new
Seamless messaging across cloud providers:
:::

```csharp
public class FederatedTransport : ITransport, IFederatedTransport {
    private readonly Dictionary<CloudProvider, ICloudTransport> _transports;
    private readonly FederationRouter _router;
    private readonly FederationOptions _options;
    
    public FederatedTransport(FederationOptions options) {
        _options = options;
        _transports = new Dictionary<CloudProvider, ICloudTransport>();
        _router = new FederationRouter(options.RoutingRules);
        
        // Initialize cloud transports
        InitializeTransports();
    }
    
    private void InitializeTransports() {
        if (_options.EnableAWS) {
            _transports[CloudProvider.AWS] = new AWSTransport(_options.AWS);
        }
        
        if (_options.EnableAzure) {
            _transports[CloudProvider.Azure] = new AzureServiceBusTransport(_options.Azure);
        }
        
        if (_options.EnableGCP) {
            _transports[CloudProvider.GCP] = new GooglePubSubTransport(_options.GCP);
        }
    }
    
    public async Task Publish<TMessage>(TMessage message, string topic)
        where TMessage : IMessage {
        
        // Determine target clouds based on routing rules
        var targets = _router.GetTargetClouds(topic, message);
        
        // Publish to all target clouds
        var tasks = targets.Select(cloud => 
            _transports[cloud].Publish(message, topic)
        );
        
        await Task.WhenAll(tasks);
    }
    
    public async Task Bridge(BridgeConfiguration config) {
        // Bridge messages between clouds
        await Subscribe<IMessage>(config.SourceTopic, async message => {
            // Transform if needed
            var transformed = await config.Transform(message);
            
            // Publish to target cloud
            await _transports[config.TargetCloud]
                .Publish(transformed, config.TargetTopic);
        });
    }
}

public class FederationRouter {
    private readonly List<RoutingRule> _rules;
    
    public CloudProvider[] GetTargetClouds<TMessage>(string topic, TMessage message) {
        var targets = new HashSet<CloudProvider>();
        
        foreach (var rule in _rules) {
            if (rule.Matches(topic, message)) {
                targets.UnionWith(rule.TargetClouds);
                
                if (rule.StopProcessing) break;
            }
        }
        
        return targets.ToArray();
    }
}

public class RoutingRule {
    public string TopicPattern { get; set; }
    public CloudProvider[] TargetClouds { get; set; }
    public Func<IMessage, bool> Predicate { get; set; }
    public bool StopProcessing { get; set; }
    
    public bool Matches<TMessage>(string topic, TMessage message) {
        if (!Regex.IsMatch(topic, TopicPattern)) return false;
        
        if (Predicate != null) {
            return Predicate(message as IMessage);
        }
        
        return true;
    }
}
```

### Global Message Routing

```csharp
public class GlobalMessageRouter {
    private readonly IFederatedTransport _transport;
    private readonly IGeoLocationService _geoLocation;
    private readonly ILatencyMonitor _latencyMonitor;
    
    public async Task<CloudProvider> SelectOptimalCloud(string destination) {
        // Get current location
        var currentRegion = await _geoLocation.GetCurrentRegion();
        
        // Get latency metrics
        var latencies = await _latencyMonitor.GetLatencies(currentRegion);
        
        // Select cloud with lowest latency
        return latencies
            .OrderBy(l => l.Value)
            .First()
            .Key;
    }
    
    public async Task RouteWithFailover<TMessage>(
        TMessage message, 
        string topic) where TMessage : IMessage {
        
        var primaryCloud = await SelectOptimalCloud(topic);
        
        try {
            await _transport.GetTransport(primaryCloud)
                .Publish(message, topic);
        }
        catch (CloudTransportException) {
            // Failover to secondary
            var secondaryCloud = GetFailoverCloud(primaryCloud);
            await _transport.GetTransport(secondaryCloud)
                .Publish(message, topic);
        }
    }
}
```

## Monitoring & Observability

### Cross-Cloud Tracing

```csharp
public class CloudTransportTracing {
    private readonly ITracer _tracer;
    
    public async Task<T> TraceCloudOperation<T>(
        string operationName,
        CloudProvider provider,
        Func<Task<T>> operation) {
        
        using var span = _tracer.StartSpan(operationName, new SpanContext {
            Tags = {
                ["cloud.provider"] = provider.ToString(),
                ["cloud.region"] = GetRegion(provider),
                ["transport.type"] = "cloud"
            }
        });
        
        try {
            var result = await operation();
            span.SetTag("success", true);
            return result;
        }
        catch (Exception ex) {
            span.RecordException(ex);
            span.SetTag("success", false);
            throw;
        }
    }
}
```

## Performance at Scale

| Cloud Provider | Throughput | Latency (same region) | Latency (cross-region) | Cost per Million |
|----------------|------------|----------------------|------------------------|------------------|
| AWS SQS/SNS | 3K msg/s per queue | < 10ms | 50-150ms | $0.40 |
| Azure Service Bus | 2K msg/s | < 15ms | 60-180ms | $0.50 |
| Google Pub/Sub | 10K msg/s | < 20ms | 70-200ms | $0.45 |
| Federated | Varies | < 25ms | 100-250ms | Combined |

## Testing Cloud Transports

```csharp
[Test]
public class CloudTransportTests {
    [Test]
    public async Task Federation_ShouldRouteToMultipleClouds() {
        // Arrange
        var federation = new FederatedTransport(new FederationOptions {
            EnableAWS = true,
            EnableAzure = true,
            RoutingRules = new[] {
                new RoutingRule {
                    TopicPattern = "global.*",
                    TargetClouds = new[] { CloudProvider.AWS, CloudProvider.Azure }
                }
            }
        });
        
        // Act
        await federation.Publish(new TestMessage(), "global.events");
        
        // Assert - verify message in both clouds
        // ...
    }
}
```

## Related Documentation

- [v0.3.0 Message Queues](../../v0.3.0/features/transports.md) - Queue transports
- [v0.4.0 Streaming](../../v0.4.0/streaming/transports.md) - gRPC and streaming
- [Cloud Architecture](../guides/cloud-architecture.md) - Multi-cloud patterns
- [Cost Optimization](../guides/cloud-cost.md) - Managing cloud messaging costs