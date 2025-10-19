---
title: .NET Aspire Integration
category: Getting Started
order: 3
tags: aspire, local-development, orchestration, docker
---

# .NET Aspire Integration

Whizbang provides first-class support for [.NET Aspire](https://learn.microsoft.com/en-us/dotnet/aspire/), Microsoft's opinionated stack for building observable, production-ready cloud-native applications.

## Overview

With Aspire integration, you get:

- **Local emulation** of Postgres, Kafka, Redis, and other infrastructure
- **One-command setup** for end-to-end development environment
- **Service discovery** for microservices communication
- **Built-in observability** with OpenTelemetry dashboards
- **Resource orchestration** with Docker containers
- **Configuration management** across services

## Quick Start

### 1. Install Aspire Workload

```bash
dotnet workload install aspire
```

### 2. Add Whizbang Aspire Package

```bash
dotnet add package Whizbang.Aspire
```

### 3. Configure AppHost

Create an Aspire AppHost project:

```csharp{
title: "Aspire AppHost Configuration"
description: "Configure Whizbang services with Aspire"
framework: "NET8"
category: "Aspire"
difficulty: "BEGINNER"
tags: ["Aspire", "Configuration", "Local Development"]
nugetPackages: ["Aspire.Hosting", "Whizbang.Aspire"]
filename: "Program.cs"
usingStatements: ["Aspire.Hosting", "Whizbang.Aspire"]
showLineNumbers: true
}
using Aspire.Hosting;
using Whizbang.Aspire;

var builder = DistributedApplication.CreateBuilder(args);

// Add Whizbang infrastructure
var whizbang = builder.AddWhizbang("whizbang")
    .WithPostgres()       // Event store
    .WithKafka()          // Message broker
    .WithRedis()          // Caching
    .WithOpenTelemetry(); // Observability

// Add your services
var ordersService = builder.AddProject<Projects.OrdersService>("orders")
    .WithReference(whizbang);

var inventoryService = builder.AddProject<Projects.InventoryService>("inventory")
    .WithReference(whizbang);

var apiGateway = builder.AddProject<Projects.ApiGateway>("api")
    .WithReference(ordersService)
    .WithReference(inventoryService);

builder.Build().Run();
```

### 4. Configure Service

In your service's `Program.cs`:

```csharp{
title: "Service Configuration with Aspire"
description: "Wire up Whizbang in a service using Aspire"
framework: "NET8"
category: "Aspire"
difficulty: "BEGINNER"
tags: ["Aspire", "Configuration", "Microservices"]
nugetPackages: ["Whizbang.Core", "Whizbang.EventSourcing", "Whizbang.Messaging", "Whizbang.Aspire"]
filename: "Program.cs"
usingStatements: ["Microsoft.Extensions.Hosting", "Whizbang", "Whizbang.Aspire"]
showLineNumbers: true
}
using Microsoft.Extensions.Hosting;
using Whizbang;
using Whizbang.Aspire;

var builder = WebApplication.CreateBuilder(args);

// Add Aspire service defaults (observability, health checks, etc.)
builder.AddServiceDefaults();

// Add Whizbang with Aspire integration
builder.Services.AddWhizbangWithAspire(options => {
    options.ScanAssembly(typeof(Program).Assembly);

    // Infrastructure auto-configured from Aspire
    options.UseAspireEventStore();      // Connects to Aspire-managed Postgres
    options.UseAspireMessaging();       // Connects to Aspire-managed Kafka
    options.UseAspireProjectionCache(); // Connects to Aspire-managed Redis
});

var app = builder.Build();

app.MapDefaultEndpoints();  // Aspire health/metrics endpoints

app.Run();
```

### 5. Run Everything

```bash
dotnet run --project AppHost
```

This single command:

1. Starts Postgres container for event store
2. Starts Kafka + Zookeeper containers for messaging
3. Starts Redis container for caching
4. Starts all your microservices
5. Opens Aspire dashboard with logs, metrics, and traces

## Aspire Dashboard

Navigate to `http://localhost:15000` (or the URL shown in console) to see:

- **Resources** - All running containers and services
- **Logs** - Structured logs from all services
- **Traces** - Distributed tracing across services
- **Metrics** - Real-time metrics (event throughput, projection lag, etc.)
- **Health** - Service health status

## Out-of-the-Box Infrastructure

### Postgres (Event Store)

Whizbang automatically configures Postgres for event storage:

```csharp{
title: "Aspire Postgres Configuration"
description: "Auto-configured Postgres event store"
framework: "NET8"
category: "Aspire"
difficulty: "INTERMEDIATE"
tags: ["Aspire", "Postgres", "Event Store"]
nugetPackages: ["Whizbang.Aspire", "Whizbang.Postgres"]
usingStatements: ["Aspire.Hosting", "Whizbang.Aspire"]
showLineNumbers: true
}
using Aspire.Hosting;
using Whizbang.Aspire;

var builder = DistributedApplication.CreateBuilder(args);

var whizbang = builder.AddWhizbang("whizbang")
    .WithPostgres(postgres => {
        postgres.DatabaseName = "whizbang_events";
        postgres.WithPgAdmin();  // Optional: PgAdmin UI
        postgres.WithInitialData("./seed-data.sql");  // Optional: Seed data
    });
```

**What it does**:

- Starts Postgres 16 container
- Creates `whizbang_events` database
- Applies Whizbang event store schema automatically
- Configures connection string in all services
- Enables OpenTelemetry instrumentation

### Kafka (Message Broker)

Whizbang sets up Kafka for distributed messaging:

```csharp{
title: "Aspire Kafka Configuration"
description: "Auto-configured Kafka message broker"
framework: "NET8"
category: "Aspire"
difficulty: "INTERMEDIATE"
tags: ["Aspire", "Kafka", "Messaging"]
nugetPackages: ["Whizbang.Aspire", "Whizbang.Kafka"]
usingStatements: ["Aspire.Hosting", "Whizbang.Aspire"]
showLineNumbers: true
}
using Aspire.Hosting;
using Whizbang.Aspire;

var whizbang = builder.AddWhizbang("whizbang")
    .WithKafka(kafka => {
        kafka.WithKafkaUI();  // Optional: Kafka UI for topic inspection
        kafka.WithTopics(
            "whizbang.orders.events",
            "whizbang.inventory.events",
            "whizbang.shipping.events"
        );
    });
```

**What it does**:

- Starts Kafka + Zookeeper containers
- Creates topics for each domain
- Configures producers and consumers
- Enables distributed tracing for messages
- Provides Kafka UI at `http://localhost:8080`

### Redis (Caching & Projections)

Optional Redis for projection caching:

```csharp{
title: "Aspire Redis Configuration"
description: "Auto-configured Redis for caching"
framework: "NET8"
category: "Aspire"
difficulty: "INTERMEDIATE"
tags: ["Aspire", "Redis", "Caching"]
nugetPackages: ["Whizbang.Aspire"]
usingStatements: ["Aspire.Hosting", "Whizbang.Aspire"]
showLineNumbers: true
}
using Aspire.Hosting;
using Whizbang.Aspire;

var whizbang = builder.AddWhizbang("whizbang")
    .WithRedis(redis => {
        redis.WithRedisInsight();  // Optional: Redis UI
        redis.WithPersistence();   // Optional: Persist to disk
    });
```

**What it does**:

- Starts Redis container
- Configures projection caching
- Enables distributed locks for projection processing
- Provides Redis Insight UI

## Service Discovery

Services automatically discover each other through Aspire:

```csharp{
title: "Service Discovery with Aspire"
description: "Services discover each other automatically"
framework: "NET8"
category: "Aspire"
difficulty: "INTERMEDIATE"
tags: ["Aspire", "Service Discovery", "Microservices"]
nugetPackages: ["Whizbang.Aspire", "Whizbang.Messaging"]
usingStatements: ["Microsoft.Extensions.DependencyInjection", "Whizbang", "Whizbang.Aspire"]
showLineNumbers: true
}
using Microsoft.Extensions.DependencyInjection;
using Whizbang;
using Whizbang.Aspire;

// In API Gateway
builder.Services.AddWhizbangWithAspire(options => {
    options.UseMessaging(msg => {
        // Service URLs automatically resolved via Aspire
        msg.UseDomainOwnership(domains => {
            domains.RegisterDomain("Orders", "http://orders");        // Aspire resolves to actual URL
            domains.RegisterDomain("Inventory", "http://inventory");  // Aspire resolves to actual URL
        });
    });
});

// Commands automatically routed to correct service
await whizbang.Send(new PlaceOrder(...));  // Routes to http://orders (resolved by Aspire)
```

## End-to-End Example

Complete Aspire setup for microservices:

```csharp{
title: "Complete Aspire Setup"
description: "Full microservices setup with Whizbang and Aspire"
framework: "NET8"
category: "Aspire"
difficulty: "ADVANCED"
tags: ["Aspire", "Microservices", "Complete Example"]
nugetPackages: ["Aspire.Hosting", "Whizbang.Aspire"]
filename: "AppHost/Program.cs"
usingStatements: ["Aspire.Hosting", "Whizbang.Aspire"]
showLineNumbers: true
}
using Aspire.Hosting;
using Whizbang.Aspire;

var builder = DistributedApplication.CreateBuilder(args);

// Shared infrastructure
var whizbang = builder.AddWhizbang("whizbang")
    .WithPostgres(pg => {
        pg.DatabaseName = "whizbang_events";
        pg.WithPgAdmin();
    })
    .WithKafka(kafka => {
        kafka.WithKafkaUI();
        kafka.WithTopics(
            "whizbang.orders.events",
            "whizbang.inventory.events",
            "whizbang.shipping.events",
            "whizbang.payments.events"
        );
    })
    .WithRedis(redis => {
        redis.WithRedisInsight();
    })
    .WithOpenTelemetry();

// Microservices (each has own event store partition)
var orders = builder.AddProject<Projects.OrdersService>("orders")
    .WithReference(whizbang)
    .WithReplicas(3);  // Scale out

var inventory = builder.AddProject<Projects.InventoryService>("inventory")
    .WithReference(whizbang)
    .WithReplicas(2);

var shipping = builder.AddProject<Projects.ShippingService>("shipping")
    .WithReference(whizbang);

var payments = builder.AddProject<Projects.PaymentsService>("payments")
    .WithReference(whizbang);

// Analytics service (subscribes to all events)
var analytics = builder.AddProject<Projects.AnalyticsService>("analytics")
    .WithReference(whizbang);

// API Gateway
var api = builder.AddProject<Projects.ApiGateway>("api")
    .WithReference(orders)
    .WithReference(inventory)
    .WithReference(shipping)
    .WithReference(payments)
    .WithHttpsEndpoint(port: 5000);

builder.Build().Run();
```

**Running**:

```bash
dotnet run --project AppHost
```

**Starts**:

- 1 Postgres container (shared event store)
- 1 Kafka + Zookeeper (shared message broker)
- 1 Redis (shared cache)
- 3 replicas of Orders service
- 2 replicas of Inventory service
- 1 Shipping service
- 1 Payments service
- 1 Analytics service
- 1 API Gateway
- Aspire Dashboard with full observability

## Configuration Management

Aspire manages configuration across all services:

```json
{
  "Aspire": {
    "Whizbang": {
      "EventStore": {
        "ConnectionString": "*** auto-configured ***",
        "SchemaName": "whizbang",
        "AutoMigrate": true
      },
      "Messaging": {
        "Kafka": {
          "BootstrapServers": "*** auto-configured ***",
          "ConsumerGroup": "orders-service"
        }
      },
      "Projections": {
        "Redis": {
          "ConnectionString": "*** auto-configured ***"
        }
      }
    }
  }
}
```

Connection strings and URLs are **automatically injected** from Aspire infrastructure.

## Testing with Aspire

Run integration tests against Aspire-managed infrastructure:

```csharp{
title: "Integration Tests with Aspire"
description: "Test against real infrastructure via Aspire"
framework: "NET8"
category: "Testing"
difficulty: "ADVANCED"
tags: ["Testing", "Aspire", "Integration Tests"]
nugetPackages: ["Aspire.Hosting.Testing", "Whizbang.Aspire", "xUnit"]
usingStatements: ["Aspire.Hosting.Testing", "Xunit", "System.Threading.Tasks"]
showLineNumbers: true
}
using Aspire.Hosting.Testing;
using System.Threading.Tasks;
using Xunit;

public class OrderServiceTests : IClassFixture<DistributedApplicationFixture> {
    private readonly DistributedApplicationFixture _fixture;

    public OrderServiceTests(DistributedApplicationFixture fixture) {
        _fixture = fixture;
    }

    [Fact]
    public async Task PlaceOrder_PersistsToEventStore() {
        // Aspire starts Postgres, Kafka, and services
        await using var app = await _fixture.CreateApplicationAsync();
        await app.StartAsync();

        var ordersService = app.GetHttpClient("orders");

        // Test against real service with real infrastructure
        var response = await ordersService.PostAsJsonAsync("/orders", new {
            CustomerId = Guid.NewGuid(),
            Items = new[] { new { ProductId = Guid.NewGuid(), Quantity = 2, Price = 19.99 } }
        });

        response.EnsureSuccessStatusCode();

        // Events are actually persisted to Postgres
        // Projections are actually updated via Kafka
    }
}
```

Tests run against **real infrastructure** (Postgres, Kafka, etc.) managed by Aspire.

## Benefits of Aspire Integration

### For Local Development

- **One command** starts everything (databases, message brokers, services)
- **No manual Docker Compose** management
- **Automatic configuration** (connection strings, URLs)
- **Live reload** with hot reload support
- **Observability dashboard** out of the box

### For Team Onboarding

- New developers clone repo and run `dotnet run --project AppHost`
- Everything "just works" - no manual setup
- Consistent environment across team members
- Self-documenting infrastructure (defined in code)

### For Production

- Same infrastructure configuration in dev and prod
- Aspire generates Kubernetes manifests
- Easy transition from local to cloud
- Azure Container Apps / AKS deployment support

## Deployment

Generate deployment artifacts from Aspire:

```bash
# Generate Kubernetes manifests
dotnet run --project AppHost -- publish --output-path ./deploy/k8s

# Generate Docker Compose
dotnet run --project AppHost -- publish --output-path ./deploy/docker --format docker-compose

# Deploy to Azure Container Apps
azd init
azd up
```

## Next Steps

- [**Distributed Messaging**](./Roadmap/distributed-messaging.md) - Microservices with Kafka
- [**Observability**](./observability.md) - OpenTelemetry and monitoring
- [**Testing**](./testing.md) - Test with Aspire infrastructure

## Resources

- [.NET Aspire Documentation](https://learn.microsoft.com/en-us/dotnet/aspire/)
- [Whizbang Aspire Samples](https://github.com/whizbang-lib/whizbang/tree/main/samples/Aspire)
- [Aspire Dashboard Guide](https://learn.microsoft.com/en-us/dotnet/aspire/fundamentals/dashboard)
