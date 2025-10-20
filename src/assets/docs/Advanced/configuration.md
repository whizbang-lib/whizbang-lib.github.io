---
title: Configuration
category: Advanced
order: 1
tags: configuration, setup, dependency-injection, options
---

# Configuration

Whizbang provides a comprehensive configuration system that allows you to customize every aspect of the runtime, from storage backends to messaging systems, observability, and performance tuning.

## Basic Configuration

### Minimal Setup

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddWhizbang(options => {
    // Scan assemblies for handlers, aggregates, and projections
    options.ScanAssembly(typeof(Program).Assembly);
});

var app = builder.Build();
app.Run();
```

### With Storage Backend

```csharp
builder.Services.AddWhizbang(options => {
    options.ScanAssembly(typeof(Program).Assembly);
    
    // Configure event store
    options.UseEventSourcing(es => {
        es.UsePostgres(connectionString);
        // or es.UseSqlServer(connectionString);
        // or es.UseInMemory(); // for testing
    });
});
```

## Storage Configuration

### Event Store Options

```csharp
options.UseEventSourcing(es => {
    es.UsePostgres(connectionString, postgres => {
        postgres.SchemaName = "events";
        postgres.TableName = "event_store";
        postgres.SnapshotInterval = 100;
        postgres.EnableAutomaticMigrations = true;
    });
});
```

### Projection Store Options

```csharp
options.UseProjections(proj => {
    // Use same database as event store
    proj.UseSameStoreAsEvents();
    
    // Or use different database
    proj.UsePostgres(projectionConnectionString, postgres => {
        postgres.SchemaName = "projections";
        postgres.EnableAutomaticMigrations = true;
    });
    
    // Or use MongoDB for projections
    proj.UseMongoDb(mongoConnectionString, mongo => {
        mongo.DatabaseName = "whizbang_projections";
    });
});
```

## Messaging Configuration

### In-Process Messaging

```csharp
options.UseMessaging(msg => {
    msg.UseInProcess(); // Default - all handlers run in same process
});
```

### Distributed Messaging

```csharp
options.UseMessaging(msg => {
    msg.UseKafka(kafka => {
        kafka.BootstrapServers = "localhost:9092";
        kafka.ConsumerGroup = "whizbang-consumers";
        kafka.EnableIdempotency = true;
        kafka.RetryPolicy = RetryPolicy.ExponentialBackoff(
            maxRetries: 5,
            baseDelay: TimeSpan.FromSeconds(1)
        );
    });
    
    // or msg.UseRabbitMQ(...);
    // or msg.UseAzureServiceBus(...);
});
```

### Outbox Pattern

```csharp
options.UseMessaging(msg => {
    msg.UseOutbox(outbox => {
        outbox.ProcessingInterval = TimeSpan.FromSeconds(5);
        outbox.BatchSize = 100;
        outbox.RetryFailedMessages = true;
        outbox.MaxRetries = 3;
    });
});
```

## Handler Configuration

### Assembly Scanning

```csharp
options.ScanAssembly(typeof(Program).Assembly);
options.ScanAssemblies(
    typeof(OrderHandlers).Assembly,
    typeof(PaymentHandlers).Assembly
);

// Scan all assemblies in current directory
options.ScanCurrentDirectory();
```

### Manual Registration

```csharp
options.RegisterHandlers(handlers => {
    handlers.RegisterCommandHandler<PlaceOrderHandler>();
    handlers.RegisterEventHandler<OrderPlacedHandler>();
    handlers.RegisterQueryHandler<GetOrderHandler>();
});
```

### Handler Lifetime

```csharp
options.ConfigureHandlers(handlers => {
    handlers.DefaultLifetime = ServiceLifetime.Scoped;
    
    // Override specific handlers
    handlers.SetLifetime<ExpensiveHandler>(ServiceLifetime.Singleton);
});
```

## Projection Configuration

### Registration and Subscriptions

```csharp
options.UseProjections(proj => {
    proj.RegisterProjection<OrderSummaryProjection>(p => {
        p.Subscribe<OrderPlacedEvent>();
        p.Subscribe<OrderShippedEvent>();
        p.Subscribe<OrderCancelledEvent>();
        
        // Backfill from specific point
        p.BackfillFrom = DateTimeOffset.UtcNow.AddDays(-30);
        
        // Partition by customer for parallel processing
        p.PartitionBy = @event => ((dynamic)@event).CustomerId;
    });
});
```

### Performance Tuning

```csharp
proj.ConfigurePerformance(perf => {
    perf.BatchSize = 1000;
    perf.ConcurrentPartitions = Environment.ProcessorCount;
    perf.CheckpointInterval = TimeSpan.FromSeconds(10);
    perf.MaxLagBeforeAlert = TimeSpan.FromMinutes(5);
});
```

## Observability Configuration

### OpenTelemetry Integration

```csharp
options.UseObservability(obs => {
    obs.UseOpenTelemetry(otel => {
        otel.ServiceName = "my-whizbang-service";
        otel.ServiceVersion = "1.0.0";
        
        // Export to Jaeger
        otel.AddJaegerExporter(jaeger => {
            jaeger.Endpoint = new Uri("http://localhost:14268");
        });
        
        // Export to Application Insights
        otel.AddApplicationInsightsExporter(ai => {
            ai.ConnectionString = builder.Configuration.GetConnectionString("ApplicationInsights");
        });
    });
    
    // Built-in metrics
    obs.EnableMetrics = true;
    obs.EnableHealthChecks = true;
});
```

### Logging Configuration

```csharp
options.UseLogging(logging => {
    logging.LogLevel = LogLevel.Information;
    logging.LogCommands = true;
    logging.LogEvents = true;
    logging.LogQueries = false; // Can be noisy
    
    // Structured logging
    logging.UseStructuredLogging = true;
    logging.IncludeCorrelationIds = true;
});
```

## Security Configuration

### Authentication & Authorization

```csharp
options.UseSecurity(security => {
    // Require authentication for all commands
    security.RequireAuthentication = true;
    
    // Configure permissions
    security.ConfigureAuthorization(auth => {
        auth.RequirePermission<PlaceOrderCommand>("orders:write");
        auth.RequirePermission<GetOrderQuery>("orders:read");
        
        // Role-based access
        auth.RequireRole<CancelOrderCommand>("OrderManager");
    });
    
    // Multi-tenancy
    security.UseMultiTenancy(mt => {
        mt.TenantResolutionStrategy = TenantResolutionStrategy.FromClaims;
        mt.TenantClaimType = "tenant_id";
        mt.IsolateTenantData = true;
    });
});
```

### Data Protection

```csharp
options.UseSecurity(security => {
    security.UseEncryption(encryption => {
        encryption.EncryptSensitiveFields = true;
        encryption.KeyRotationInterval = TimeSpan.FromDays(90);
        
        // Azure Key Vault integration
        encryption.UseAzureKeyVault(kv => {
            kv.VaultUri = "https://my-vault.vault.azure.net/";
            kv.KeyName = "whizbang-encryption-key";
        });
    });
});
```

## Performance Configuration

### Connection Pooling

```csharp
options.ConfigurePerformance(perf => {
    perf.DatabaseConnections = conn => {
        conn.MaxPoolSize = 100;
        conn.MinPoolSize = 10;
        conn.ConnectionTimeout = TimeSpan.FromSeconds(30);
        conn.CommandTimeout = TimeSpan.FromSeconds(60);
    };
});
```

### Caching

```csharp
options.UseCaching(cache => {
    cache.UseDistributedCache(dist => {
        dist.UseRedis(redis => {
            redis.ConnectionString = "localhost:6379";
            redis.DatabaseNumber = 0;
        });
    });
    
    // Cache aggregates for read-heavy scenarios
    cache.CacheAggregates = true;
    cache.AggregateCacheDuration = TimeSpan.FromMinutes(5);
    
    // Cache projection results
    cache.CacheProjections = true;
    cache.ProjectionCacheDuration = TimeSpan.FromMinutes(1);
});
```

## Environment-Specific Configuration

### Development Environment

```csharp
if (builder.Environment.IsDevelopment()) {
    options.UseDevelopmentDefaults(dev => {
        dev.UseInMemoryStorage = true;
        dev.EnableDetailedErrors = true;
        dev.LogAllQueries = true;
        dev.EnableSwagger = true;
    });
}
```

### Production Environment

```csharp
if (builder.Environment.IsProduction()) {
    options.UseProductionDefaults(prod => {
        prod.EnableOptimizations = true;
        prod.UseConnectionPooling = true;
        prod.EnableMetrics = true;
        prod.EnableHealthChecks = true;
        prod.LogLevel = LogLevel.Warning;
    });
}
```

## Configuration from appsettings.json

```json
{
  "Whizbang": {
    "EventStore": {
      "Provider": "Postgres",
      "ConnectionString": "Host=localhost;Database=events;Username=user;Password=pass",
      "SchemaName": "events",
      "SnapshotInterval": 100
    },
    "Messaging": {
      "Provider": "Kafka",
      "BootstrapServers": "localhost:9092",
      "ConsumerGroup": "my-service-consumers"
    },
    "Projections": {
      "BatchSize": 1000,
      "ConcurrentPartitions": 4,
      "CheckpointInterval": "00:00:10"
    },
    "Observability": {
      "ServiceName": "my-whizbang-service",
      "EnableMetrics": true,
      "LogLevel": "Information"
    }
  }
}
```

```csharp
// Load from configuration
options.ConfigureFromSection(builder.Configuration.GetSection("Whizbang"));
```

## Validation and Diagnostics

### Configuration Validation

```csharp
options.ValidateConfiguration = true;
options.ValidateOnStartup = true;

// Custom validation
options.AddConfigurationValidator<CustomConfigValidator>();
```

### Health Checks

```csharp
builder.Services.AddHealthChecks()
    .AddWhizbangHealthChecks(); // Adds event store, projections, messaging health checks
```

## Related Topics

- [Getting Started](./getting-started.md) - Basic setup and configuration
- [Package Structure](./package-structure.md) - Available NuGet packages and adapters
- [.NET Aspire Integration](./aspire-integration.md) - Cloud-native configuration
- [Advanced Scenarios](./advanced-scenarios.md) - Complex configuration patterns

## Next Steps

This page covers the core configuration options in Whizbang. For specific deployment scenarios and advanced patterns, refer to the specialized documentation sections.