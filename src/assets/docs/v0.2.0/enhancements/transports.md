---
title: HTTP & WebSocket Transports
version: 0.2.0
category: Enhancements
order: 4
evolves-from: v0.1.0/components/transports.md
evolves-to: v0.3.0/features/transports.md
description: REST APIs with HTTP transport and real-time communication via WebSockets
tags: transports, http, websocket, rest, real-time, serialization, v0.2.0
---

# HTTP & WebSocket Transports

![Version](https://img.shields.io/badge/version-0.2.0-blue)
![Status](https://img.shields.io/badge/status-enhanced-green)
![Next Update](https://img.shields.io/badge/next-v0.3.0-yellow)

## Version History

:::updated
**Enhanced in v0.2.0**: 
- HTTP transport for REST APIs
- WebSocket support for real-time
- JSON and MessagePack serialization
- Retry policies and circuit breakers
:::

:::planned
**Coming in v0.3.0**: 
- Message queue transports (RabbitMQ, Kafka)
- Advanced pub/sub with topics
- Dead letter queues
- Message persistence

[See messaging features →](../../v0.3.0/features/transports.md)
:::

## New Features in v0.2.0

### HTTP Transport

:::new
Full HTTP/REST transport with client and server:
:::

```csharp
[WhizbangTransport("HTTP")]
public class HttpTransport : ITransport {
    private readonly HttpClient _httpClient;
    private readonly HttpTransportOptions _options;
    private readonly ISerializer _serializer;
    private readonly IRetryPolicy _retryPolicy;
    
    public string Name => "HTTP";
    public TransportCapabilities Capabilities => 
        TransportCapabilities.RequestResponse |
        TransportCapabilities.Reliable;
    
    public HttpTransport(HttpTransportOptions options) {
        _options = options;
        _serializer = CreateSerializer(options.SerializationFormat);
        _retryPolicy = new ExponentialBackoffRetry(options.RetryOptions);
        
        _httpClient = new HttpClient {
            BaseAddress = new Uri(options.BaseUrl),
            Timeout = options.Timeout
        };
        
        // Add default headers
        _httpClient.DefaultRequestHeaders.Add("Accept", GetContentType());
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "Whizbang/0.2.0");
    }
    
    public async Task<TResponse> Send<TRequest, TResponse>(
        TRequest request, 
        string destination)
        where TRequest : IMessage
        where TResponse : IMessage {
        
        // Build HTTP request
        var httpRequest = new HttpRequestMessage(HttpMethod.Post, destination) {
            Content = new ByteArrayContent(_serializer.Serialize(request))
        };
        
        httpRequest.Content.Headers.ContentType = new MediaTypeHeaderValue(GetContentType());
        
        // Add message headers
        foreach (var header in request.Headers) {
            httpRequest.Headers.Add($"X-Whizbang-{header.Key}", header.Value);
        }
        
        // Add correlation ID for tracing
        httpRequest.Headers.Add("X-Correlation-Id", request.Id.ToString());
        
        // Execute with retry
        var response = await _retryPolicy.Execute(async () => 
            await _httpClient.SendAsync(httpRequest)
        );
        
        response.EnsureSuccessStatusCode();
        
        // Deserialize response
        var responseBytes = await response.Content.ReadAsByteArrayAsync();
        return _serializer.Deserialize<TResponse>(responseBytes);
    }
    
    private string GetContentType() {
        return _options.SerializationFormat switch {
            SerializationFormat.Json => "application/json",
            SerializationFormat.MessagePack => "application/msgpack",
            SerializationFormat.Protobuf => "application/protobuf",
            _ => "application/octet-stream"
        };
    }
}
```

### HTTP Server Endpoint

:::new
ASP.NET Core integration for receiving HTTP messages:
:::

```csharp
public class WhizbangHttpEndpoint {
    private readonly ITransportDispatcher _dispatcher;
    private readonly ISerializer _serializer;
    
    public void MapEndpoints(IEndpointRouteBuilder endpoints) {
        endpoints.MapPost("/api/messages/{destination}", HandleMessage);
        endpoints.MapGet("/api/health", HandleHealth);
    }
    
    private async Task<IResult> HandleMessage(
        string destination,
        HttpRequest request,
        CancellationToken ct) {
        
        try {
            // Read message
            using var reader = new StreamReader(request.Body);
            var body = await reader.ReadToEndAsync();
            
            // Determine message type from header
            var messageType = request.Headers["X-Message-Type"].FirstOrDefault();
            if (string.IsNullOrEmpty(messageType)) {
                return Results.BadRequest("Missing X-Message-Type header");
            }
            
            // Deserialize
            var type = Type.GetType(messageType);
            var message = _serializer.Deserialize(body, type);
            
            // Extract correlation ID
            var correlationId = request.Headers["X-Correlation-Id"].FirstOrDefault();
            
            // Dispatch to handler
            var response = await _dispatcher.Dispatch(message, destination, correlationId);
            
            // Serialize response
            var responseBody = _serializer.Serialize(response);
            
            return Results.Ok(responseBody);
        }
        catch (HandlerNotFoundException ex) {
            return Results.NotFound(ex.Message);
        }
        catch (ValidationException ex) {
            return Results.BadRequest(ex.Message);
        }
        catch (Exception ex) {
            _logger.LogError(ex, "Failed to handle message");
            return Results.StatusCode(500);
        }
    }
}

// Registration in Program.cs
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddWhizbangHttpTransport();

var app = builder.Build();
app.MapWhizbangEndpoints();
```

### WebSocket Transport

:::new
Real-time bidirectional communication:
:::

```csharp
[WhizbangTransport("WebSocket")]
public class WebSocketTransport : ITransport, IStreamingTransport {
    private readonly ClientWebSocket _webSocket;
    private readonly WebSocketOptions _options;
    private readonly ISerializer _serializer;
    private readonly ConcurrentDictionary<Guid, TaskCompletionSource<IMessage>> _pendingRequests;
    private readonly ConcurrentDictionary<string, List<Func<IMessage, Task>>> _subscriptions;
    
    public string Name => "WebSocket";
    public TransportCapabilities Capabilities => 
        TransportCapabilities.RequestResponse |
        TransportCapabilities.PublishSubscribe |
        TransportCapabilities.Streaming |
        TransportCapabilities.Ordered;
    
    public async Task Connect(string url) {
        _webSocket = new ClientWebSocket();
        await _webSocket.ConnectAsync(new Uri(url), CancellationToken.None);
        
        // Start receive loop
        _ = Task.Run(ReceiveLoop);
        
        // Start heartbeat
        _ = Task.Run(HeartbeatLoop);
    }
    
    public async Task<TResponse> Send<TRequest, TResponse>(
        TRequest request, 
        string destination)
        where TRequest : IMessage
        where TResponse : IMessage {
        
        var envelope = new MessageEnvelope {
            Id = request.Id,
            Type = MessageType.Request,
            Destination = destination,
            Payload = _serializer.Serialize(request),
            Headers = request.Headers
        };
        
        // Register pending request
        var tcs = new TaskCompletionSource<IMessage>();
        _pendingRequests[request.Id] = tcs;
        
        // Send over WebSocket
        await SendEnvelope(envelope);
        
        // Wait for response with timeout
        using var cts = new CancellationTokenSource(_options.RequestTimeout);
        cts.Token.Register(() => tcs.TrySetCanceled());
        
        var response = await tcs.Task;
        return (TResponse)response;
    }
    
    public async Task Publish<TMessage>(TMessage message, string topic)
        where TMessage : IMessage {
        
        var envelope = new MessageEnvelope {
            Id = message.Id,
            Type = MessageType.Publish,
            Topic = topic,
            Payload = _serializer.Serialize(message),
            Headers = message.Headers
        };
        
        await SendEnvelope(envelope);
    }
    
    public async Task Subscribe<TMessage>(string topic, Func<TMessage, Task> handler)
        where TMessage : IMessage {
        
        // Register local handler
        if (!_subscriptions.ContainsKey(topic)) {
            _subscriptions[topic] = new List<Func<IMessage, Task>>();
        }
        
        _subscriptions[topic].Add(async msg => await handler((TMessage)msg));
        
        // Send subscription request
        var envelope = new MessageEnvelope {
            Id = Guid.NewGuid(),
            Type = MessageType.Subscribe,
            Topic = topic
        };
        
        await SendEnvelope(envelope);
    }
    
    private async Task ReceiveLoop() {
        var buffer = new ArraySegment<byte>(new byte[4096]);
        
        while (_webSocket.State == WebSocketState.Open) {
            try {
                var result = await _webSocket.ReceiveAsync(buffer, CancellationToken.None);
                
                if (result.MessageType == WebSocketMessageType.Close) {
                    await HandleClose();
                    break;
                }
                
                if (result.MessageType == WebSocketMessageType.Binary) {
                    var envelope = DeserializeEnvelope(buffer.Array, result.Count);
                    await HandleEnvelope(envelope);
                }
            }
            catch (Exception ex) {
                _logger.LogError(ex, "WebSocket receive error");
                await Reconnect();
            }
        }
    }
    
    private async Task HandleEnvelope(MessageEnvelope envelope) {
        switch (envelope.Type) {
            case MessageType.Response:
                // Complete pending request
                if (_pendingRequests.TryRemove(envelope.CorrelationId, out var tcs)) {
                    var response = _serializer.Deserialize(envelope.Payload, envelope.PayloadType);
                    tcs.SetResult(response);
                }
                break;
                
            case MessageType.Event:
                // Dispatch to subscribers
                if (_subscriptions.TryGetValue(envelope.Topic, out var handlers)) {
                    var message = _serializer.Deserialize(envelope.Payload, envelope.PayloadType);
                    var tasks = handlers.Select(h => h(message));
                    await Task.WhenAll(tasks);
                }
                break;
        }
    }
}
```

### Message Serialization

:::new
Multiple serialization formats:
:::

```csharp
public interface ISerializer {
    byte[] Serialize<T>(T value);
    T Deserialize<T>(byte[] data);
    object Deserialize(byte[] data, Type type);
}

// JSON serializer with compression
public class CompressedJsonSerializer : ISerializer {
    private readonly JsonSerializerOptions _options;
    
    public CompressedJsonSerializer() {
        _options = new JsonSerializerOptions {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            Converters = {
                new JsonStringEnumConverter(),
                new DateTimeOffsetConverter()
            }
        };
    }
    
    public byte[] Serialize<T>(T value) {
        var json = JsonSerializer.SerializeToUtf8Bytes(value, _options);
        
        // Compress if larger than threshold
        if (json.Length > 1024) {
            return Compress(json);
        }
        
        return json;
    }
    
    private byte[] Compress(byte[] data) {
        using var output = new MemoryStream();
        
        // Write compression marker
        output.WriteByte(0xFF);
        
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal)) {
            gzip.Write(data, 0, data.Length);
        }
        
        return output.ToArray();
    }
}

// MessagePack serializer
public class MessagePackSerializer : ISerializer {
    private readonly MessagePackSerializerOptions _options;
    
    public MessagePackSerializer() {
        _options = MessagePackSerializerOptions.Standard
            .WithCompression(MessagePackCompression.Lz4BlockArray)
            .WithSecurity(MessagePackSecurity.UntrustedData);
    }
    
    public byte[] Serialize<T>(T value) {
        return MessagePack.MessagePackSerializer.Serialize(value, _options);
    }
    
    public T Deserialize<T>(byte[] data) {
        return MessagePack.MessagePackSerializer.Deserialize<T>(data, _options);
    }
}
```

### Retry and Resilience

:::new
Built-in retry policies:
:::

```csharp
public class ResilientHttpTransport : HttpTransport {
    private readonly ICircuitBreaker _circuitBreaker;
    private readonly IRetryPolicy _retryPolicy;
    
    public override async Task<TResponse> Send<TRequest, TResponse>(
        TRequest request,
        string destination) {
        
        return await _circuitBreaker.Execute(async () => {
            return await _retryPolicy.Execute(async () => {
                try {
                    return await base.Send<TRequest, TResponse>(request, destination);
                }
                catch (HttpRequestException ex) when (IsTransient(ex)) {
                    _logger.LogWarning("Transient error, will retry: {Message}", ex.Message);
                    throw;
                }
            });
        });
    }
    
    private bool IsTransient(HttpRequestException ex) {
        // Retry on specific status codes
        return ex.StatusCode is 
            HttpStatusCode.ServiceUnavailable or
            HttpStatusCode.GatewayTimeout or
            HttpStatusCode.TooManyRequests;
    }
}
```

## Configuration

```csharp
// HTTP transport configuration
services.AddWhizbangTransports(options => {
    options.UseHttp(http => {
        http.BaseUrl = "https://api.example.com";
        http.Timeout = TimeSpan.FromSeconds(30);
        http.SerializationFormat = SerializationFormat.MessagePack;
        
        http.RetryOptions = new RetryOptions {
            MaxAttempts = 3,
            InitialDelay = TimeSpan.FromMilliseconds(100),
            MaxDelay = TimeSpan.FromSeconds(5),
            BackoffMultiplier = 2
        };
    });
});

// WebSocket configuration
services.AddWhizbangTransports(options => {
    options.UseWebSocket(ws => {
        ws.Url = "wss://realtime.example.com/hub";
        ws.ReconnectInterval = TimeSpan.FromSeconds(5);
        ws.HeartbeatInterval = TimeSpan.FromSeconds(30);
        ws.RequestTimeout = TimeSpan.FromSeconds(10);
    });
});
```

## Testing HTTP/WebSocket Transports

```csharp
[Test]
public class HttpTransportTests {
    private HttpTransport _transport;
    private MockHttpMessageHandler _mockHttp;
    
    [SetUp]
    public void Setup() {
        _mockHttp = new MockHttpMessageHandler();
        _transport = new HttpTransport(new HttpTransportOptions {
            BaseUrl = "http://test.local"
        }, _mockHttp);
    }
    
    [Test]
    public async Task Send_ShouldSerializeAndDeserialize() {
        // Arrange
        _mockHttp.Expect(HttpMethod.Post, "http://test.local/api/orders")
            .Respond("application/json", 
                JsonSerializer.Serialize(new OrderResponse { Success = true }));
        
        // Act
        var response = await _transport.Send<CreateOrderCommand, OrderResponse>(
            new CreateOrderCommand { CustomerId = Guid.NewGuid() },
            "/api/orders"
        );
        
        // Assert
        Assert.True(response.Success);
        _mockHttp.VerifyNoOutstandingExpectation();
    }
}
```

## Performance Characteristics

| Operation | v0.1.0 (In-Process) | v0.2.0 (HTTP) | v0.2.0 (WebSocket) |
|-----------|-------------------|---------------|-------------------|
| Send | < 100ns | < 50ms | < 10ms |
| Publish | < 1μs | N/A | < 5ms |
| Latency | 0 | Network dependent | Lower than HTTP |
| Throughput | Unlimited | Limited by HTTP | Higher than HTTP |

## Migration from v0.1.0

### Supporting Multiple Transports

```csharp
// v0.1.0 - In-process only
services.AddWhizbangTransports(options => {
    options.UseInProcess();
});

// v0.2.0 - Support both for gradual migration
services.AddWhizbangTransports(options => {
    options.UseInProcess();  // For local components
    options.UseHttp(http => {  // For remote components
        http.BaseUrl = Configuration["RemoteApi:BaseUrl"];
    });
});

// Transport selector
public class TransportSelector {
    public ITransport SelectTransport(string destination) {
        return destination.StartsWith("http://") 
            ? GetTransport<HttpTransport>()
            : GetTransport<InProcessTransport>();
    }
}
```

## Related Documentation

- [v0.1.0 Foundation](../../v0.1.0/components/transports.md) - In-process transport
- [v0.3.0 Message Queues](../../v0.3.0/features/transports.md) - Async messaging
- [API Design](../guides/api-design.md) - REST API best practices
- [WebSocket Guide](../guides/websocket-patterns.md) - Real-time patterns