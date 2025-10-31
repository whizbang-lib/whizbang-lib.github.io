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

```csharp{
title: "Minimal Whizbang Setup"
description: "Basic Whizbang configuration with assembly scanning"
framework: "NET8"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["Setup", "Configuration", "Assembly Scanning"]
filename: "Program.cs"
usingStatements: ["Microsoft.AspNetCore.Builder", "Whizbang"]
showLineNumbers: true
}
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

```csharp{
title: "Whizbang with Storage Backend"
description: "Configuration with PostgreSQL event store"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Event Store", "PostgreSQL", "Storage"]
filename: "Program.cs"
usingStatements: ["Whizbang", "Whizbang.EventSourcing"]
showLineNumbers: true
}
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

```csharp{
title: "PostgreSQL Event Store Configuration"
description: "Detailed PostgreSQL event store options"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Event Store", "PostgreSQL", "Schema", "Snapshots"]
filename: "Program.cs"
usingStatements: ["Whizbang.EventSourcing"]
showLineNumbers: true
}
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

```csharp{
title: "Projection Store Configuration"
description: "Multiple projection store options including PostgreSQL and MongoDB"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Projections", "PostgreSQL", "MongoDB", "Storage"]
filename: "Program.cs"
usingStatements: ["Whizbang.Projections"]
showLineNumbers: true
}
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

```csharp{
title: "In-Process Messaging Configuration"
description: "Configure in-process messaging for single application"
framework: "NET8"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["Messaging", "In-Process"]
filename: "Program.cs"
usingStatements: ["Whizbang.Messaging"]
showLineNumbers: true
}
options.UseMessaging(msg => {
    msg.UseInProcess(); // Default - all handlers run in same process
});
```

### Distributed Messaging

```csharp{
title: "Distributed Messaging with Kafka"
description: "Configure Kafka for distributed messaging with retry policies"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Messaging", "Kafka", "Distributed", "Retry Policy"]
filename: "Program.cs"
usingStatements: ["System", "Whizbang.Messaging"]
showLineNumbers: true
}
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

```csharp{
title: "Outbox Pattern Configuration"
description: "Configure outbox pattern for reliable message delivery"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Outbox Pattern", "Messaging", "Reliability"]
filename: "Program.cs"
usingStatements: ["System", "Whizbang.Messaging"]
showLineNumbers: true
}
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

```csharp{
title: "Assembly Scanning Configuration"
description: "Configure assembly scanning for handlers and aggregates"
framework: "NET8"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["Assembly Scanning", "Handlers", "Discovery"]
filename: "Program.cs"
usingStatements: ["Whizbang"]
showLineNumbers: true
}
options.ScanAssembly(typeof(Program).Assembly);
options.ScanAssemblies(
    typeof(OrderHandlers).Assembly,
    typeof(PaymentHandlers).Assembly
);

// Scan all assemblies in current directory
options.ScanCurrentDirectory();
```

### Manual Registration

```csharp{
title: "Manual Handler Registration"
description: "Manually register specific handlers instead of assembly scanning"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Handlers", "Registration", "Manual"]
filename: "Program.cs"
usingStatements: ["Whizbang"]
showLineNumbers: true
}
options.RegisterHandlers(handlers => {
    handlers.RegisterCommandHandler<PlaceOrderHandler>();
    handlers.RegisterEventHandler<OrderPlacedHandler>();
    handlers.RegisterQueryHandler<GetOrderHandler>();
});
```

### Handler Lifetime

```csharp{
title: "Handler Lifetime Configuration"
description: "Configure service lifetimes for handlers"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Handlers", "Lifetime", "Dependency Injection"]
filename: "Program.cs"
usingStatements: ["Microsoft.Extensions.DependencyInjection", "Whizbang"]
showLineNumbers: true
}
options.ConfigureHandlers(handlers => {
    handlers.DefaultLifetime = ServiceLifetime.Scoped;
    
    // Override specific handlers
    handlers.SetLifetime<ExpensiveHandler>(ServiceLifetime.Singleton);
});
```

## Projection Configuration

### Registration and Subscriptions

```csharp{
title: "Projection Registration and Subscriptions"
description: "Register projections with event subscriptions and partitioning"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Projections", "Event Subscriptions", "Partitioning", "Backfill"]
filename: "Program.cs"
usingStatements: ["System", "Whizbang.Projections"]
showLineNumbers: true
}
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

```csharp{
title: "Projection Performance Tuning"
description: "Configure projection performance settings for batch processing"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Projections", "Performance", "Batch Processing", "Concurrency"]
filename: "Program.cs"
usingStatements: ["System", "Whizbang.Projections"]
showLineNumbers: true
}
proj.ConfigurePerformance(perf => {
    perf.BatchSize = 1000;
    perf.ConcurrentPartitions = Environment.ProcessorCount;
    perf.CheckpointInterval = TimeSpan.FromSeconds(10);
    perf.MaxLagBeforeAlert = TimeSpan.FromMinutes(5);
});
```

## Observability Configuration

### OpenTelemetry Integration

```csharp{
title: "OpenTelemetry Observability Configuration"
description: "Configure OpenTelemetry with Jaeger and Application Insights exporters"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Observability", "OpenTelemetry", "Jaeger", "Application Insights"]
filename: "Program.cs"
usingStatements: ["System", "Microsoft.Extensions.Configuration", "Whizbang.Observability"]
showLineNumbers: true
}
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

```csharp{
title: "Logging Configuration"
description: "Configure structured logging with correlation IDs"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Logging", "Structured Logging", "Correlation IDs"]
filename: "Program.cs"
usingStatements: ["Microsoft.Extensions.Logging", "Whizbang.Logging"]
showLineNumbers: true
}
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

```csharp{
title: "Security and Authorization Configuration"
description: "Configure authentication, authorization, and multi-tenancy"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Security", "Authentication", "Authorization", "Multi-Tenancy"]
filename: "Program.cs"
usingStatements: ["Whizbang.Security"]
showLineNumbers: true
}
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

```csharp{
title: "Data Protection and Encryption"
description: "Configure data encryption with Azure Key Vault integration"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Security", "Encryption", "Azure Key Vault", "Data Protection"]
filename: "Program.cs"
usingStatements: ["System", "Whizbang.Security"]
showLineNumbers: true
}
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

```csharp{
title: "Database Connection Pooling"
description: "Configure database connection pool settings for performance"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Performance", "Database", "Connection Pooling"]
filename: "Program.cs"
usingStatements: ["System", "Whizbang.Performance"]
showLineNumbers: true
}
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

```csharp{
title: "Distributed Caching Configuration"
description: "Configure Redis caching for aggregates and projections"
framework: "NET8"
category: "Configuration"
difficulty: "ADVANCED"
tags: ["Caching", "Redis", "Performance", "Distributed Cache"]
filename: "Program.cs"
usingStatements: ["System", "Whizbang.Caching"]
showLineNumbers: true
}
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

```csharp{
title: "Development Environment Configuration"
description: "Configure development-specific settings and features"
framework: "NET8"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["Development", "Environment", "In-Memory Storage", "Swagger"]
filename: "Program.cs"
usingStatements: ["Microsoft.Extensions.Hosting", "Whizbang"]
showLineNumbers: true
}
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

```csharp{
title: "Production Environment Configuration"
description: "Configure production-specific optimizations and monitoring"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Production", "Environment", "Optimizations", "Monitoring"]
filename: "Program.cs"
usingStatements: ["Microsoft.Extensions.Hosting", "Microsoft.Extensions.Logging", "Whizbang"]
showLineNumbers: true
}
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

```csharp{
title: "Loading Configuration from appsettings.json"
description: "Load Whizbang configuration from appsettings.json section"
framework: "NET8"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["Configuration", "appsettings.json", "Settings"]
filename: "Program.cs"
usingStatements: ["Microsoft.Extensions.Configuration", "Whizbang"]
showLineNumbers: true
}
// Load from configuration
options.ConfigureFromSection(builder.Configuration.GetSection("Whizbang"));
```

## Validation and Diagnostics

### Configuration Validation

```csharp{
title: "Configuration Validation"
description: "Enable configuration validation with custom validators"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Validation", "Configuration", "Startup"]
filename: "Program.cs"
usingStatements: ["Whizbang"]
showLineNumbers: true
}
options.ValidateConfiguration = true;
options.ValidateOnStartup = true;

// Custom validation
options.AddConfigurationValidator<CustomConfigValidator>();
```

### Health Checks

```csharp{
title: "Health Checks Configuration"
description: "Add Whizbang health checks for monitoring system components"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Health Checks", "Monitoring", "Diagnostics"]
filename: "Program.cs"
usingStatements: ["Microsoft.Extensions.DependencyInjection", "Whizbang.HealthChecks"]
showLineNumbers: true
}
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