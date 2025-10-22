---
title: Advanced Scenarios
category: Advanced
order: 1
tags: seeding, bff, control-plane, scaled-environments
---

# Advanced Scenarios

This document covers advanced scenarios for production deployments, including data seeding, Backend-for-Frontend (BFF) patterns, and central control commands.

## Data Seeding in Scaled Environments

When deploying to scaled-out environments (Kubernetes, multiple replicas), data seeding must be coordinated to avoid duplicates or race conditions.

### Coordinated Seeding

```csharp{
title: "Coordinated Data Seeding"
description: "Seed data in scaled environments without duplicates"
framework: "NET8"
category: "Deployment"
difficulty: "ADVANCED"
tags: ["Seeding", "Deployment", "Kubernetes"]
nugetPackages: ["Whizbang.Core", "Whizbang.EventSourcing"]
usingStatements: ["Microsoft.Extensions.Hosting", "Whizbang", "System", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Whizbang;

public class DataSeeder : IHostedService {
    private readonly IWhizbang _whizbang;
    private readonly IDistributedLock _distributedLock;

    public DataSeeder(IWhizbang whizbang, IDistributedLock distributedLock) {
        _whizbang = whizbang;
        _distributedLock = distributedLock;
    }

    public async Task StartAsync(CancellationToken cancellationToken) {
        // Only ONE replica seeds data (distributed lock)
        await using var @lock = await _distributedLock.AcquireAsync("data-seeding", TimeSpan.FromMinutes(5));

        if (@lock != null) {
            await SeedDataAsync();
        }
    }

    private async Task SeedDataAsync() {
        // Check if already seeded
        var alreadySeeded = await CheckIfSeededAsync();
        if (alreadySeeded) {
            return;
        }

        // Seed master data
        await SeedProductCatalogAsync();
        await SeedDefaultTenantsAsync();
        await SeedReferenceDataAsync();

        // Mark as seeded
        await MarkAsSeededAsync();
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
```

### Idempotent Seeding

Make seeding operations idempotent:

```csharp{
title: "Idempotent Seeding"
description: "Seed data that can be run multiple times safely"
framework: "NET8"
category: "Deployment"
difficulty: "INTERMEDIATE"
tags: ["Seeding", "Idempotence"]
nugetPackages: ["Whizbang.Core", "Whizbang.EventSourcing"]
usingStatements: ["System", "System.Threading.Tasks", "Whizbang"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang;

public class ProductCatalogSeeder {
    private readonly IRepository<ProductCatalog> _repository;

    public ProductCatalogSeeder(IRepository<ProductCatalog> repository) {
        _repository = repository;
    }

    public async Task SeedAsync() {
        // Idempotent: only create if doesn't exist
        var catalog = await _repository.FindAsync(WellKnownIds.DefaultCatalog);

        if (catalog == null) {
            catalog = new ProductCatalog(WellKnownIds.DefaultCatalog, "Default Catalog");

            catalog.AddProduct(new Product("Widget", 19.99m));
            catalog.AddProduct(new Product("Gadget", 29.99m));
            catalog.AddProduct(new Product("Doohickey", 39.99m));

            await _repository.SaveAsync(catalog);
        }
    }
}
```

### Environment-Specific Seeding

Different data for dev/staging/production:

```csharp{
title: "Environment-Specific Seeding"
description: "Seed different data per environment"
framework: "NET8"
category: "Deployment"
difficulty: "INTERMEDIATE"
tags: ["Seeding", "Environments"]
nugetPackages: ["Whizbang.Core", "Microsoft.Extensions.Hosting"]
usingStatements: ["Microsoft.Extensions.Hosting", "System.Threading.Tasks"]
showLineNumbers: true
}
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;

public class EnvironmentSeeder : IHostedService {
    private readonly IHostEnvironment _env;
    private readonly IDataSeeder _seeder;

    public EnvironmentSeeder(IHostEnvironment env, IDataSeeder seeder) {
        _env = env;
        _seeder = seeder;
    }

    public async Task StartAsync(CancellationToken cancellationToken) {
        if (_env.IsDevelopment()) {
            // Seed lots of test data for local development
            await _seeder.SeedDevelopmentDataAsync();
            await _seeder.SeedTestTenantsAsync(count: 10);
            await _seeder.SeedSampleOrdersAsync(count: 1000);
        }
        else if (_env.IsStaging()) {
            // Seed realistic production-like data
            await _seeder.SeedProductionLikeDataAsync();
            await _seeder.SeedTestTenantsAsync(count: 2);  // Fewer test tenants
        }
        else if (_env.IsProduction()) {
            // Only seed essential master data
            await _seeder.SeedMasterDataAsync();
            // Do NOT seed test data in production
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
```

### Kubernetes Init Container Seeding

Use Kubernetes init containers for pre-startup seeding:

```yaml{
title: "Kubernetes Init Container for Data Seeding"
description: "Kubernetes deployment configuration with init container for data seeding"
framework: "Kubernetes"
category: "Advanced"
difficulty: "ADVANCED"
tags: ["Kubernetes", "Seeding", "Deployment", "Init Containers"]
filename: "orders-service-deployment.yaml"
showLineNumbers: true
}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-service
spec:
  replicas: 3
  template:
    spec:
      # Init container runs BEFORE main container
      initContainers:
      - name: seed-data
        image: myapp/orders-service:latest
        command: ["dotnet", "OrdersService.dll", "--seed-only"]
        env:
        - name: ASPNETCORE_ENVIRONMENT
          value: "Production"

      # Main application container
      containers:
      - name: orders-service
        image: myapp/orders-service:latest
```

**Application code**:

```csharp{
title: "Program.cs Seeding Logic"
description: "Application startup logic for seed-only mode"
framework: "NET8"
category: "Advanced"
difficulty: "INTERMEDIATE"
tags: ["Seeding", "Startup", "Program.cs"]
filename: "Program.cs"
usingStatements: ["Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
// In Program.cs
if (args.Contains("--seed-only")) {
    await SeedDataAsync(app.Services);
    return;  // Exit after seeding
}

await app.RunAsync();  // Normal startup
```

---

## Backend-for-Frontend (BFF) Support

BFF pattern creates backend APIs tailored to specific frontend applications (web, mobile, desktop).

### BFF Architecture

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  Web App    │       │ Mobile App  │       │ Desktop App │
│  (React)    │       │  (Swift)    │       │  (WinUI)    │
└──────┬──────┘       └──────┬──────┘       └──────┬──────┘
       │                     │                     │
       ↓                     ↓                     ↓
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Web BFF   │       │  Mobile BFF │       │ Desktop BFF │
│  (GraphQL)  │       │   (REST)    │       │  (gRPC)     │
└──────┬──────┘       └──────┬──────┘       └──────┬──────┘
       │                     │                     │
       └─────────────┬───────┴─────────────────────┘
                     ↓
              ┌──────────────┐
              │   Whizbang   │
              │  Microservices│
              └──────────────┘
```

### Creating a BFF with Whizbang

```csharp{
title: "Web BFF Implementation"
description: "Backend-for-Frontend for web application"
framework: "NET8"
category: "BFF"
difficulty: "ADVANCED"
tags: ["BFF", "GraphQL", "Web"]
nugetPackages: ["Whizbang.Core", "HotChocolate"]
filename: "WebBFF/Program.cs"
usingStatements: ["Microsoft.AspNetCore.Builder", "Whizbang", "HotChocolate"]
showLineNumbers: true
}
using Microsoft.AspNetCore.Builder;
using Whizbang;
using HotChocolate;

var builder = WebApplication.CreateBuilder(args);

// Add Whizbang as client (sends commands/queries to backend services)
builder.Services.AddWhizbangClient(options => {
    options.UseDomainOwnership(domains => {
        domains.RegisterDomain("Orders", "http://orders-service");
        domains.RegisterDomain("Inventory", "http://inventory-service");
        domains.RegisterDomain("Customers", "http://customers-service");
    });
});

// Add GraphQL for web frontend
builder.Services
    .AddGraphQLServer()
    .AddQueryType<WebQuery>()
    .AddMutationType<WebMutation>();

var app = builder.Build();

app.MapGraphQL();
app.Run();

// GraphQL types optimized for web UI
public class WebQuery {
    public async Task<CustomerDashboard> GetDashboardAsync(
        [Service] IWhizbang whizbang,
        Guid customerId
    ) {
        // Aggregate data from multiple services
        var customer = await whizbang.QueryAsync(new GetCustomer(customerId));
        var orders = await whizbang.QueryAsync(new GetCustomerOrders(customerId));
        var recommendations = await whizbang.QueryAsync(new GetRecommendations(customerId));

        // Return web-optimized payload
        return new CustomerDashboard(customer, orders, recommendations);
    }
}
```

### Mobile BFF (Optimized for Bandwidth)

```csharp{
title: "Mobile BFF Implementation"
description: "Backend-for-Frontend for mobile apps (minimal payloads)"
framework: "NET8"
category: "BFF"
difficulty: "ADVANCED"
tags: ["BFF", "Mobile", "REST"]
nugetPackages: ["Whizbang.Core", "Microsoft.AspNetCore"]
filename: "MobileBFF/Program.cs"
usingStatements: ["Microsoft.AspNetCore.Builder", "Microsoft.AspNetCore.Http", "Whizbang", "System", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Whizbang;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddWhizbangClient(/* ... */);

var app = builder.Build();

// Mobile-optimized endpoints (minimal payloads, pagination)
app.MapGet("/mobile/orders", async (IWhizbang whizbang, Guid customerId, int page) => {
    var orders = await whizbang.QueryAsync(new GetCustomerOrders(customerId) {
        Page = page,
        PageSize = 20,  // Mobile shows 20 at a time
        IncludeFields = new[] { "id", "status", "total", "placedAt" }  // Minimal fields
    });

    // Return mobile-friendly response
    return Results.Ok(new {
        orders = orders.Select(o => new {
            id = o.Id,
            status = o.Status,
            total = $"${o.Total:F2}",  // Pre-formatted for display
            date = o.PlacedAt.ToString("MMM dd")
        }),
        hasMore = orders.Count == 20
    });
});

app.Run();
```

### BFF Aggregation Pattern

BFFs aggregate data from multiple services:

```csharp{
title: "BFF Data Aggregation"
description: "Aggregate data from multiple services in BFF"
framework: "NET8"
category: "BFF"
difficulty: "ADVANCED"
tags: ["BFF", "Aggregation", "Microservices"]
nugetPackages: ["Whizbang.Core"]
usingStatements: ["System", "System.Threading.Tasks", "System.Linq", "Whizbang"]
showLineNumbers: true
}
using System;
using System.Linq;
using System.Threading.Tasks;
using Whizbang;

public class OrderDetailsAggregator {
    private readonly IWhizbang _whizbang;

    public OrderDetailsAggregator(IWhizbang whizbang) {
        _whizbang = whizbang;
    }

    public async Task<OrderDetailsViewModel> GetOrderDetailsAsync(Guid orderId) {
        // Query multiple services in parallel
        var orderTask = _whizbang.QueryAsync(new GetOrder(orderId));
        var customerTask = _whizbang.QueryAsync(new GetCustomer(/* customerId from order */));
        var inventoryTask = _whizbang.QueryAsync(new GetInventoryStatus(orderId));
        var shippingTask = _whizbang.QueryAsync(new GetShippingStatus(orderId));

        await Task.WhenAll(orderTask, customerTask, inventoryTask, shippingTask);

        // Aggregate into view model
        return new OrderDetailsViewModel {
            Order = orderTask.Result,
            Customer = customerTask.Result,
            Inventory = inventoryTask.Result,
            Shipping = shippingTask.Result,
            EstimatedDelivery = CalculateEstimatedDelivery(shippingTask.Result)
        };
    }
}
```

---

## Central Control Commands

Central control plane for managing distributed services (configuration changes, projection rebuilds, diagnostics).

### Control Plane Architecture

```
┌────────────────────────────────────────┐
│      Whizbang Control Dashboard        │
│  (Web UI for operators/administrators) │
└───────────────┬────────────────────────┘
                │
                ↓
┌───────────────────────────────────────┐
│       Control Plane Service           │
│   (Sends control commands to services)│
└───────────────┬───────────────────────┘
                │
       ┌────────┴────────┬──────────┐
       ↓                 ↓          ↓
┌──────────┐      ┌──────────┐  ┌──────────┐
│ Orders   │      │Inventory │  │ Shipping │
│ Service  │      │ Service  │  │ Service  │
└──────────┘      └──────────┘  └──────────┘
```

### Control Commands

```csharp{
title: "Control Command Definitions"
description: "Central commands for managing services"
framework: "NET8"
category: "Control Plane"
difficulty: "ADVANCED"
tags: ["Control Plane", "Operations", "Commands"]
nugetPackages: ["Whizbang.ControlPlane"]
usingStatements: ["System", "Whizbang.ControlPlane"]
showLineNumbers: true
}
using System;
using Whizbang.ControlPlane;

// Rebuild a projection across all services
public record RebuildProjection(
    string ProjectionName,
    DateTimeOffset? StartFrom = null
) : ControlCommand;

// Change log level dynamically
public record SetLogLevel(
    string Category,
    LogLevel Level
) : ControlCommand;

// Enable/disable feature flags
public record ToggleFeature(
    string FeatureName,
    bool Enabled
) : ControlCommand;

// Trigger health check
public record RunHealthCheck() : ControlCommand;

// Clear caches
public record ClearCaches(
    string[] CacheNames
) : ControlCommand;
```

### Control Command Handler

Services implement handlers for control commands:

```csharp{
title: "Control Command Handler"
description: "Handle central control commands in services"
framework: "NET8"
category: "Control Plane"
difficulty: "ADVANCED"
tags: ["Control Plane", "Handlers"]
nugetPackages: ["Whizbang.Core", "Whizbang.ControlPlane", "Whizbang.Projections"]
usingStatements: ["System", "System.Threading.Tasks", "Microsoft.Extensions.Logging", "Whizbang.ControlPlane", "Whizbang.Projections"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Whizbang.ControlPlane;
using Whizbang.Projections;

public class RebuildProjectionHandler {
    private readonly IProjectionEngine _projectionEngine;
    private readonly ILogger _logger;

    public RebuildProjectionHandler(IProjectionEngine projectionEngine, ILogger logger) {
        _projectionEngine = projectionEngine;
        _logger = logger;
    }

    public async Task Handle(RebuildProjection command) {
        _logger.LogWarning("Rebuilding projection {ProjectionName} from {StartFrom}",
            command.ProjectionName,
            command.StartFrom ?? DateTimeOffset.MinValue
        );

        // Stop projection
        await _projectionEngine.StopProjectionAsync(command.ProjectionName);

        // Clear projection data
        await _projectionEngine.ClearProjectionAsync(command.ProjectionName);

        // Restart from specified point
        await _projectionEngine.StartProjectionAsync(command.ProjectionName, command.StartFrom);

        _logger.LogInformation("Projection {ProjectionName} rebuild started", command.ProjectionName);
    }
}
```

### Sending Control Commands

From the control dashboard:

```csharp{
title: "Sending Control Commands"
description: "Send control commands from central dashboard"
framework: "NET8"
category: "Control Plane"
difficulty: "INTERMEDIATE"
tags: ["Control Plane", "Dashboard"]
nugetPackages: ["Whizbang.ControlPlane"]
usingStatements: ["System", "System.Threading.Tasks", "Whizbang.ControlPlane"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang.ControlPlane;

public class ControlPlaneClient {
    private readonly IWhizbangControlPlane _controlPlane;

    public ControlPlaneClient(IWhizbangControlPlane controlPlane) {
        _controlPlane = controlPlane;
    }

    public async Task RebuildProjectionAcrossAllServicesAsync(string projectionName) {
        // Send command to ALL services that have this projection
        await _controlPlane.BroadcastAsync(new RebuildProjection(projectionName));
    }

    public async Task RebuildProjectionOnSpecificServiceAsync(string service, string projection) {
        // Send command to specific service only
        await _controlPlane.SendToServiceAsync(service, new RebuildProjection(projection));
    }

    public async Task SetLogLevelGloballyAsync(string category, LogLevel level) {
        // Change log level across all services
        await _controlPlane.BroadcastAsync(new SetLogLevel(category, level));
    }
}
```

## Next Steps

- [**Whizbang Dashboard**](./dashboard.md) - Visual control plane
- [**Observability**](./observability.md) - Monitoring and tracing
- [**Distributed Messaging**](./Roadmap/distributed-messaging.md) - Microservices architecture
