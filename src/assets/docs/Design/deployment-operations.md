---
title: Deployment & Operations
category: Architecture & Design
order: 15
tags: deployment, operations, kubernetes, health-checks, graceful-shutdown
---

# Deployment & Operations

Whizbang is designed as an embedded library that runs within developer services, providing comprehensive operational hooks for production deployment, monitoring, and lifecycle management.

## Deployment Model

### Embedded Library Architecture

**Whizbang runs embedded** within your application, not as a separate service:

```csharp
---
category: Design
difficulty: BEGINNER
tags: [Design, Deployment, Embedded-Library, ASP.NET-Core]
description: Basic embedded library setup within ASP.NET Core application
---
// Your service with Whizbang embedded
public class Program {
    public static void Main(string[] args) {
        var builder = WebApplication.CreateBuilder(args);
        
        // Add your application services
        builder.Services.AddControllers();
        builder.Services.AddOrderService();
        
        // Add Whizbang as embedded library
        builder.Services.AddWhizbang(options => {
            options.UsePostgresEventStore(connectionString);
            options.UseKafkaMessageBroker(kafkaConfig);
            options.ConfigureDomains();
        });
        
        var app = builder.Build();
        
        // Configure your application pipeline
        app.MapControllers();
        app.MapWhizbangEndpoints(); // Optional: Expose Whizbang endpoints
        
        app.Run();
    }
}
```

### Service Architecture Patterns

**Multiple deployment patterns** supported:

#### 1. Monolithic Deployment

```yaml
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Kubernetes, Monolithic-Deployment]
description: Kubernetes deployment configuration for monolithic service architecture
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ecommerce-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ecommerce-service
  template:
    metadata:
      labels:
        app: ecommerce-service
    spec:
      containers:
      - name: ecommerce-service
        image: myapp/ecommerce-service:latest
        ports:
        - containerPort: 8080
        env:
        - name: WHIZBANG_EVENTSTORE_CONNECTION
          valueFrom:
            secretKeyRef:
              name: database-secrets
              key: connection-string
        - name: WHIZBANG_MESSAGEBROKER_BOOTSTRAP_SERVERS
          value: "kafka:9092"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
```

#### 2. Microservices Deployment

```yaml
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Kubernetes, Microservices, Separation-of-Concerns]
description: Kubernetes deployment for microservices with separated command and projection services
---
# Command Service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-command-service
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: order-service
        image: myapp/order-service:latest
        env:
        - name: WHIZBANG_DOMAIN
          value: "Orders"
        - name: WHIZBANG_PROJECTION_MODE
          value: "Disabled" # Command service doesn't run projections

---
# Projection Worker Service  
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-projection-worker
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: projection-worker
        image: myapp/order-projection-worker:latest
        env:
        - name: WHIZBANG_DOMAIN
          value: "Orders"
        - name: WHIZBANG_COMMAND_MODE
          value: "Disabled" # Projection worker doesn't handle commands
        - name: WHIZBANG_PROJECTIONS
          value: "OrderSummary,OrderHistory,OrderAnalytics"
```

#### 3. Domain-per-Service Deployment

```yaml
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Kubernetes, Domain-per-Service]
description: Domain-per-service deployment pattern with domain ownership configuration
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-service
spec:
  template:
    spec:
      containers:
      - name: orders-service
        image: myapp/orders-service:latest
        env:
        - name: WHIZBANG_OWNED_DOMAINS
          value: "Orders"

---
apiVersion: apps/v1  
kind: Deployment
metadata:
  name: inventory-service
spec:
  template:
    spec:
      containers:
      - name: inventory-service
        image: myapp/inventory-service:latest
        env:
        - name: WHIZBANG_OWNED_DOMAINS
          value: "Inventory"
```

## Health Checks

### Built-in Health Check System

**Comprehensive health monitoring** ready for Kubernetes probes:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Health-Checks, Monitoring]
description: Comprehensive health check configuration for production readiness
---
services.AddWhizbang(options => {
    options.HealthChecks(health => {
        // Core infrastructure health
        health.CheckEventStoreConnection = true;
        health.CheckMessageBrokerConnection = true;
        health.CheckProjectionHealth = true;
        
        // Operational thresholds
        health.ProjectionLagThreshold = TimeSpan.FromMinutes(5);
        health.EventStoreLatencyThreshold = TimeSpan.FromMilliseconds(100);
        health.MessageBrokerLatencyThreshold = TimeSpan.FromMilliseconds(500);
        
        // Custom health checks
        health.AddCheck<CustomBusinessLogicHealthCheck>();
    });
});

// Register health check endpoints
app.MapHealthChecks("/health", new HealthCheckOptions {
    ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions {
    Predicate = check => check.Tags.Contains("ready"),
    ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse
});

app.MapHealthChecks("/health/live", new HealthCheckOptions {
    Predicate = check => check.Tags.Contains("live")
});
```

### Health Check Implementation

**Detailed health check implementation**:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Health-Checks, Implementation]
description: Detailed health check implementation for infrastructure components
---
public class WhizbangHealthCheck : IHealthCheck {
    private readonly IEventStore _eventStore;
    private readonly IMessageBroker _messageBroker;
    private readonly IProjectionManager _projectionManager;
    private readonly WhizbangHealthOptions _options;
    
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default) {
        var checks = new List<(string name, bool healthy, string? details)>();
        
        // Event store connectivity
        if (_options.CheckEventStoreConnection) {
            try {
                await _eventStore.HealthCheckAsync(cancellationToken);
                checks.Add(("EventStore", true, "Connected"));
            } catch (Exception ex) {
                checks.Add(("EventStore", false, ex.Message));
            }
        }
        
        // Message broker connectivity
        if (_options.CheckMessageBrokerConnection) {
            try {
                await _messageBroker.HealthCheckAsync(cancellationToken);
                checks.Add(("MessageBroker", true, "Connected"));
            } catch (Exception ex) {
                checks.Add(("MessageBroker", false, ex.Message));
            }
        }
        
        // Projection health
        if (_options.CheckProjectionHealth) {
            var projections = await _projectionManager.GetAllProjectionsAsync(cancellationToken);
            foreach (var projection in projections) {
                var lag = await _projectionManager.GetLagAsync(projection.Name, cancellationToken);
                var healthy = lag <= _options.ProjectionLagThreshold;
                checks.Add(($"Projection:{projection.Name}", healthy, $"Lag: {lag.TotalSeconds}s"));
            }
        }
        
        // Determine overall health
        var allHealthy = checks.All(c => c.healthy);
        var status = allHealthy ? HealthStatus.Healthy : HealthStatus.Unhealthy;
        
        var data = checks.ToDictionary(c => c.name, c => (object)new { 
            healthy = c.healthy, 
            details = c.details 
        });
        
        return new HealthCheckResult(status, data: data);
    }
}
```

## Graceful Shutdown

### .NET Host Lifetime Integration

**Proper integration** with .NET hosting lifetime for clean shutdown:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Graceful-Shutdown, Hosting-Integration]
description: .NET hosted service integration with graceful shutdown support
---
public class WhizbangHostedService : IHostedService, IDisposable {
    private readonly IWhizbangRuntime _runtime;
    private readonly ILogger<WhizbangHostedService> _logger;
    private readonly WhizbangOptions _options;
    
    public async Task StartAsync(CancellationToken cancellationToken) {
        _logger.LogInformation("Starting Whizbang runtime");
        await _runtime.StartAsync(cancellationToken);
        _logger.LogInformation("Whizbang runtime started");
    }
    
    public async Task StopAsync(CancellationToken cancellationToken) {
        _logger.LogInformation("Stopping Whizbang runtime");
        
        try {
            // Stop accepting new messages
            await _runtime.StopAcceptingMessagesAsync(cancellationToken);
            _logger.LogInformation("Stopped accepting new messages");
            
            // Drain in-flight messages with timeout
            var drainTimeout = _options.GracefulShutdownTimeout ?? TimeSpan.FromSeconds(30);
            using var drainCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            drainCts.CancelAfter(drainTimeout);
            
            await _runtime.DrainInFlightMessagesAsync(drainCts.Token);
            _logger.LogInformation("Drained in-flight messages");
            
            // Stop projections
            await _runtime.StopProjectionsAsync(cancellationToken);
            _logger.LogInformation("Stopped projections");
            
            // Close connections
            await _runtime.CloseConnectionsAsync(cancellationToken);
            _logger.LogInformation("Closed connections");
            
        } catch (OperationCanceledException) {
            _logger.LogWarning("Graceful shutdown timed out, forcing shutdown");
        } catch (Exception ex) {
            _logger.LogError(ex, "Error during graceful shutdown");
        }
        
        _logger.LogInformation("Whizbang runtime stopped");
    }
    
    public void Dispose() {
        _runtime?.Dispose();
    }
}
```

### Kubernetes Integration

**SIGTERM handling** for Kubernetes graceful shutdown:

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Deployment, Graceful-Shutdown, Kubernetes-Integration]
description: Kubernetes SIGTERM handling with graceful shutdown and load balancer drain
---
public class GracefulShutdownService : BackgroundService {
    private readonly IHostApplicationLifetime _applicationLifetime;
    private readonly IWhizbangRuntime _runtime;
    private readonly ILogger<GracefulShutdownService> _logger;
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        // Register for shutdown notification
        _applicationLifetime.ApplicationStopping.Register(OnShutdown);
        
        // Wait for shutdown
        await Task.Delay(Timeout.Infinite, stoppingToken);
    }
    
    private void OnShutdown() {
        _logger.LogInformation("Received shutdown signal, initiating graceful shutdown");
        
        // Custom shutdown logic
        Task.Run(async () => {
            try {
                // Give projections time to finish current batch
                await _runtime.CompleteCurrentBatchAsync(TimeSpan.FromSeconds(10));
                
                // Signal readiness probe to fail (remove from load balancer)
                _runtime.MarkAsNotReady();
                
                // Wait for load balancer to drain
                await Task.Delay(TimeSpan.FromSeconds(5));
                
                _logger.LogInformation("Graceful shutdown preparation complete");
            } catch (Exception ex) {
                _logger.LogError(ex, "Error during shutdown preparation");
            }
        });
    }
}
```

## Configuration Management

### Environment-Specific Configuration

**Flexible configuration** for different deployment environments:

```json
---
category: Design
difficulty: BEGINNER
tags: [Design, Deployment, Configuration, Environment-Management]
description: Environment-specific configuration management with base and override files
---
// appsettings.json (base configuration)
{
  "Whizbang": {
    "EventStore": {
      "Driver": "Postgres"
    },
    "MessageBroker": {
      "Driver": "Kafka"
    },
    "Projections": {
      "DefaultStrategy": "Automatic"
    }
  }
}

// appsettings.Development.json
{
  "Whizbang": {
    "EventStore": {
      "ConnectionString": "Host=localhost;Database=whizbang_dev",
      "EnableDetailedLogging": true
    },
    "MessageBroker": {
      "BootstrapServers": "localhost:9092",
      "EnableAutoCommit": true
    },
    "Observability": {
      "Level": "Verbose",
      "SampleRate": 1.0
    }
  }
}

// appsettings.Production.json
{
  "Whizbang": {
    "EventStore": {
      "ConnectionString": "", // Set via environment variable
      "PoolSize": 20,
      "CommandTimeout": 30
    },
    "MessageBroker": {
      "BootstrapServers": "", // Set via environment variable
      "SecurityProtocol": "SaslSsl",
      "EnableIdempotence": true
    },
    "Observability": {
      "Level": "Standard",
      "SampleRate": 0.1
    },
    "HealthChecks": {
      "ProjectionLagThresholdMinutes": 5,
      "EventStoreLatencyThresholdMs": 100
    }
  }
}
```

### Secret Management

**Secure credential handling**:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Security, Secret-Management]
description: Secure credential handling with Azure Key Vault and Kubernetes secrets
---
// Using Azure Key Vault
builder.Configuration.AddAzureKeyVault(
    new Uri("https://myapp-keyvault.vault.azure.net/"),
    new DefaultAzureCredential()
);

// Using Kubernetes secrets
services.AddWhizbang(options => {
    // Connection string from Kubernetes secret
    var connectionString = Environment.GetEnvironmentVariable("WHIZBANG_EVENTSTORE_CONNECTION")
        ?? throw new InvalidOperationException("Event store connection string not configured");
    
    options.UsePostgresEventStore(connectionString);
    
    // Message broker configuration from environment
    options.UseKafkaMessageBroker(kafka => {
        kafka.BootstrapServers = Environment.GetEnvironmentVariable("KAFKA_BOOTSTRAP_SERVERS");
        kafka.SecurityProtocol = Enum.Parse<SecurityProtocol>(
            Environment.GetEnvironmentVariable("KAFKA_SECURITY_PROTOCOL") ?? "Plaintext"
        );
        
        if (kafka.SecurityProtocol != SecurityProtocol.Plaintext) {
            kafka.SaslUsername = Environment.GetEnvironmentVariable("KAFKA_SASL_USERNAME");
            kafka.SaslPassword = Environment.GetEnvironmentVariable("KAFKA_SASL_PASSWORD");
        }
    });
});
```

## Monitoring and Alerting

### Production Monitoring Setup

**Comprehensive monitoring stack** integration:

```yaml
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Monitoring, Prometheus, Grafana]
description: Production monitoring setup with Prometheus and Grafana dashboard configuration
---
# Prometheus ServiceMonitor for metrics scraping
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: whizbang-metrics
spec:
  selector:
    matchLabels:
      app: ecommerce-service
  endpoints:
  - port: metrics
    path: /metrics
    interval: 30s
    scrapeTimeout: 10s

---
# Grafana dashboard ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: whizbang-dashboard
data:
  dashboard.json: |
    {
      "dashboard": {
        "title": "Whizbang Application Metrics",
        "panels": [
          {
            "title": "Command Processing Rate",
            "targets": [
              {
                "expr": "rate(whizbang_command_total[5m])",
                "legendFormat": "{{command_type}}"
              }
            ]
          }
        ]
      }
    }
```

### Log Aggregation

**Structured logging** for centralized log management:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Logging, Structured-Logging]
description: Structured logging configuration for centralized log management
---
services.AddWhizbang(options => {
    options.Logging(logging => {
        logging.StructuredLogging = true;
        logging.IncludeCorrelationIds = true;
        logging.IncludeDomainContext = true;
        logging.SanitizeSensitiveData = true;
        
        // Log levels by component
        logging.SetLogLevel("Whizbang.Commands", LogLevel.Information);
        logging.SetLogLevel("Whizbang.Events", LogLevel.Information);
        logging.SetLogLevel("Whizbang.Projections", LogLevel.Warning);
        logging.SetLogLevel("Whizbang.Policies", LogLevel.Debug);
    });
});

// Example structured log output
{
  "timestamp": "2024-01-01T10:00:00.000Z",
  "level": "Information",
  "messageTemplate": "Command {CommandType} processed for domain {Domain}",
  "properties": {
    "CommandType": "PlaceOrder",
    "Domain": "Orders",
    "CorrelationId": "abc-123-def",
    "TenantId": "tenant-456",
    "ExecutionTimeMs": 45,
    "Success": true
  }
}
```

## Scaling Strategies

### Horizontal Scaling

**Scale-out patterns** for high throughput:

```yaml
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Kubernetes, Auto-Scaling, HPA]
description: Horizontal pod autoscaler configuration with custom metrics
---
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ecommerce-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ecommerce-service
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  - type: Pods
    pods:
      metric:
        name: whizbang_projection_lag_seconds
      target:
        type: AverageValue
        averageValue: "300" # Scale when lag > 5 minutes
```

### Vertical Scaling

**Resource optimization** for different workloads:

```yaml
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Deployment, Kubernetes, Resource-Optimization, Vertical-Scaling]
description: Resource optimization configurations for different workload types
---
# Command-heavy service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-command-service
spec:
  template:
    spec:
      containers:
      - name: order-service
        resources:
          requests:
            cpu: 500m      # Higher CPU for command processing
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 1Gi

---
# Projection-heavy service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: analytics-projection-worker
spec:
  template:
    spec:
      containers:
      - name: projection-worker
        resources:
          requests:
            cpu: 200m
            memory: 1Gi    # Higher memory for projection state
          limits:
            cpu: 1000m
            memory: 4Gi
```

## Best Practices

### Deployment Guidelines

1. **Start simple** - Begin with monolithic deployment, extract services as needed
2. **Use health checks** - Implement comprehensive liveness and readiness probes
3. **Plan for scaling** - Design with horizontal scaling in mind
4. **Monitor everything** - Set up observability before going to production
5. **Test failure modes** - Practice chaos engineering and disaster recovery

### Configuration Management

1. **Environment parity** - Keep development and production configs similar
2. **Secure secrets** - Never store credentials in code or config files
3. **Validate on startup** - Fail fast if configuration is invalid
4. **Document settings** - Maintain clear documentation of all configuration options
5. **Version configurations** - Track configuration changes alongside code

### Operational Excellence

1. **Automate deployments** - Use CI/CD pipelines for consistent deployments
2. **Monitor SLOs** - Define and track service level objectives
3. **Plan for disasters** - Regular backup and recovery testing
4. **Capacity planning** - Monitor trends and plan for growth
5. **Regular maintenance** - Schedule updates and maintenance windows

---

## Related Documentation

- [**Observability & Metrics**](./observability-metrics.md) - Production monitoring setup
- [**Testing & Development Tools**](./testing-development-tools.md) - Testing deployment configurations
- [**Advanced Features**](./advanced-features.md) - Kubernetes operator features