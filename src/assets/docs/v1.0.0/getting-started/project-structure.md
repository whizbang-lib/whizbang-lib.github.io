---
title: Project Structure Guide
version: 1.0.0
category: Getting Started
order: 4
description: >-
  Organize your Whizbang application with recommended project structures,
  separation of concerns, and multi-service architectures
tags: 'project-structure, architecture, organization, best-practices'
codeReferences:
  - samples/ECommerce/
  - samples/ECommerce/ECommerce.Messages/
  - samples/ECommerce/ECommerce.OrderService.API/
  - samples/ECommerce/ECommerce.BFF.API/
---

# Project Structure Guide

This guide shows recommended project structures for Whizbang applications, from simple single-project apps to complex multi-service architectures.

## Quick Reference

| Architecture | When to Use | Example |
|--------------|-------------|---------|
| [Single Project](#single-project-structure) | Simple apps, prototypes, learning | Todo app, simple API |
| [Clean Architecture](#clean-architecture-structure) | Medium apps, clear boundaries | E-commerce site, CRM |
| [Microservices](#microservices-structure) | Distributed systems, team scaling | Multi-tenant SaaS, complex domains |

## Core Principles

Regardless of project size, follow these principles:

1. **Separate Messages from Logic** - Commands/Events in dedicated projects
2. **Stateless Receptors** - No state in message handlers
3. **Read Model Isolation** - Perspectives maintain their own data
4. **Explicit Dependencies** - Clear project references, no circular dependencies
5. **Configuration by Environment** - appsettings.{Environment}.json pattern

---

## Single Project Structure

**Best for**: Learning, prototypes, simple APIs (< 10 message types)

```
MyApp/
├── MyApp.API/                          # Single ASP.NET Core project
│   ├── Program.cs                      # DI configuration + app setup
│   ├── appsettings.json
│   ├── appsettings.Development.json
│   │
│   ├── Messages/                       # Commands and Events
│   │   ├── Commands/
│   │   │   ├── CreateOrder.cs
│   │   │   └── CancelOrder.cs
│   │   └── Events/
│   │       ├── OrderCreated.cs
│   │       └── OrderCancelled.cs
│   │
│   ├── Receptors/                      # Message handlers
│   │   ├── CreateOrderReceptor.cs
│   │   └── CancelOrderReceptor.cs
│   │
│   ├── Perspectives/                   # Read model updaters
│   │   └── OrderSummaryPerspective.cs
│   │
│   ├── Lenses/                         # Query interfaces
│   │   └── OrderLens.cs
│   │
│   ├── Endpoints/                      # HTTP endpoints
│   │   └── OrdersController.cs
│   │
│   └── Models/                         # Read models / DTOs
│       └── OrderSummary.cs
│
└── MyApp.API.Tests/                    # Tests
    ├── Receptors/
    │   └── CreateOrderReceptorTests.cs
    └── Perspectives/
        └── OrderSummaryPerspectiveTests.cs
```

### Program.cs Setup

```csharp{title="Program.cs Setup" description="Demonstrates program.cs Setup" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Program.cs", "Setup"]}
using Whizbang.Core;
using Whizbang.Data.Dapper.Postgres;

var builder = WebApplication.CreateBuilder(args);

// Whizbang Core
builder.Services.AddWhizbangCore();

// Auto-discovery (with Whizbang.Generators)
builder.Services.AddDiscoveredReceptors();
builder.Services.AddDiscoveredPerspectives();

// Data access
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")!;
builder.Services.AddWhizbangDapper(connectionString);

// Controllers
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment()) {
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
```

### Message Organization

**Commands** (imperative - intent to change state):
```csharp{title="Message Organization" description="Commands (imperative - intent to change state):" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Message", "Organization"]}
// Messages/Commands/CreateOrder.cs
namespace MyApp.API.Messages.Commands;

public record CreateOrder(
    Guid CustomerId,
    OrderLineItem[] Items
);

public record OrderLineItem(
    Guid ProductId,
    int Quantity,
    decimal UnitPrice
);
```

**Events** (past tense - fact of what happened):
```csharp{title="Message Organization - OrderCreated" description="Events (past tense - fact of what happened):" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Message", "Organization"]}
// Messages/Events/OrderCreated.cs
namespace MyApp.API.Messages.Events;

public record OrderCreated(
    Guid OrderId,
    Guid CustomerId,
    OrderLineItem[] Items,
    decimal Total,
    DateTimeOffset CreatedAt
);
```

### Pros and Cons

**Pros**:
- ✅ Simple to understand and navigate
- ✅ Fast to set up and iterate
- ✅ Single deployment unit
- ✅ Easy debugging (single process)

**Cons**:
- ❌ Limited scalability (single service)
- ❌ Can become cluttered as app grows
- ❌ All logic in one deployable
- ❌ Hard to scale specific components independently

---

## Clean Architecture Structure

**Best for**: Medium-sized applications with clear domain boundaries

```
MyApp/
├── src/
│   ├── MyApp.Messages/                 # Shared message contracts
│   │   ├── Commands/
│   │   │   ├── CreateOrder.cs
│   │   │   └── CancelOrder.cs
│   │   ├── Events/
│   │   │   ├── OrderCreated.cs
│   │   │   └── OrderCancelled.cs
│   │   └── MyApp.Messages.csproj
│   │
│   ├── MyApp.Domain/                   # Business logic (receptors)
│   │   ├── Receptors/
│   │   │   ├── CreateOrderReceptor.cs
│   │   │   └── CancelOrderReceptor.cs
│   │   └── MyApp.Domain.csproj         # References: Messages, Whizbang.Core
│   │
│   ├── MyApp.ReadModels/               # Perspectives and Lenses
│   │   ├── Perspectives/
│   │   │   ├── OrderSummaryPerspective.cs
│   │   │   └── InventoryPerspective.cs
│   │   ├── Lenses/
│   │   │   ├── OrderLens.cs
│   │   │   └── InventoryLens.cs
│   │   ├── Models/
│   │   │   ├── OrderSummary.cs
│   │   │   └── InventoryLevel.cs
│   │   └── MyApp.ReadModels.csproj     # References: Messages, Whizbang.Core
│   │
│   └── MyApp.API/                      # HTTP API
│       ├── Program.cs
│       ├── Endpoints/
│       │   ├── OrderEndpoints.cs
│       │   └── InventoryEndpoints.cs
│       └── MyApp.API.csproj            # References: Domain, ReadModels
│
├── tests/
│   ├── MyApp.Domain.Tests/
│   │   └── Receptors/
│   │       └── CreateOrderReceptorTests.cs
│   ├── MyApp.ReadModels.Tests/
│   │   └── Perspectives/
│   │       └── OrderSummaryPerspectiveTests.cs
│   └── MyApp.Integration.Tests/
│       └── OrderWorkflowTests.cs
│
└── MyApp.sln
```

### Project Dependencies

```
MyApp.API
  ├─> MyApp.Domain
  ├─> MyApp.ReadModels
  └─> Whizbang.Core

MyApp.Domain
  ├─> MyApp.Messages
  └─> Whizbang.Core

MyApp.ReadModels
  ├─> MyApp.Messages
  ├─> Whizbang.Core
  └─> Whizbang.Data.Dapper.Postgres

MyApp.Messages
  └─> (no dependencies - pure DTOs)
```

**Key Point**: Messages project has **no dependencies** - makes it easy to share across services.

### Central Package Management

Use `Directory.Packages.props` for version consistency:

```xml{title="Central Package Management" description="Use `Directory." category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Central", "Package", "Management"]}
<!-- Directory.Packages.props (solution root) -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>

  <ItemGroup>
    <PackageVersion Include="Whizbang.Core" Version="0.1.0" />
    <PackageVersion Include="Whizbang.Generators" Version="0.1.0" />
    <PackageVersion Include="Whizbang.Data.Dapper.Postgres" Version="0.1.0" />
    <PackageVersion Include="Whizbang.Transports.AzureServiceBus" Version="0.1.0" />
  </ItemGroup>
</Project>
```

Then in project files:
```xml{title="Central Package Management (2)" description="Then in project files:" category="Configuration" difficulty="BEGINNER" tags=["Getting-Started", "Central", "Package", "Management"]}
<!-- MyApp.API.csproj -->
<ItemGroup>
  <PackageReference Include="Whizbang.Core" />  <!-- Version comes from Directory.Packages.props -->
  <PackageReference Include="Whizbang.Generators" />
</ItemGroup>
```

### Shared Build Properties

Use `Directory.Build.props` for consistent settings:

```xml{title="Shared Build Properties" description="Use `Directory." category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Shared", "Build", "Properties"]}
<!-- Directory.Build.props (solution root) -->
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>13</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>

  <PropertyGroup>
    <!-- Source Generator Settings -->
    <EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
    <CompilerGeneratedFilesOutputPath>$(MSBuildProjectDirectory)/.whizbang-generated</CompilerGeneratedFilesOutputPath>
  </PropertyGroup>
</Project>
```

### Pros and Cons

**Pros**:
- ✅ Clear separation of concerns
- ✅ Testable in isolation
- ✅ Reusable message contracts
- ✅ Easy to understand dependencies
- ✅ Can grow to microservices later

**Cons**:
- ❌ More projects to manage
- ❌ Still a single deployable
- ❌ Some indirection (navigate across projects)

---

## Microservices Structure

**Best for**: Distributed systems, team scaling, independent deployment needs

This is the structure used in the **ECommerce sample** (12 projects).

```
ECommerce/
├── src/
│   ├── ECommerce.Messages/             # Shared contracts (commands + events)
│   │   ├── Commands/
│   │   │   ├── CreateOrder.cs
│   │   │   ├── ReserveInventory.cs
│   │   │   └── ProcessPayment.cs
│   │   ├── Events/
│   │   │   ├── OrderCreated.cs
│   │   │   ├── InventoryReserved.cs
│   │   │   └── PaymentProcessed.cs
│   │   └── ECommerce.Messages.csproj
│   │
│   ├── ECommerce.BFF.API/              # Backend for Frontend (UI layer)
│   │   ├── Program.cs
│   │   ├── Perspectives/               # Read models for UI
│   │   │   ├── OrderSummaryPerspective.cs
│   │   │   ├── InventoryPerspective.cs
│   │   │   └── ShippingPerspective.cs
│   │   ├── Lenses/                     # Query interfaces
│   │   │   ├── OrderLens.cs
│   │   │   └── InventoryLens.cs
│   │   ├── Hubs/                       # SignalR real-time
│   │   │   └── OrderHub.cs
│   │   └── Endpoints/
│   │       └── OrderEndpoints.cs
│   │
│   ├── ECommerce.OrderService.API/     # Order management service
│   │   ├── Program.cs
│   │   ├── Receptors/
│   │   │   ├── CreateOrderReceptor.cs
│   │   │   └── CancelOrderReceptor.cs
│   │   └── Endpoints/
│   │       └── OrdersController.cs
│   │
│   ├── ECommerce.InventoryWorker/      # Inventory reservation (background worker)
│   │   ├── Program.cs
│   │   ├── Receptors/
│   │   │   └── ReserveInventoryReceptor.cs
│   │   └── Workers/
│   │       └── InventoryWorker.cs
│   │
│   ├── ECommerce.PaymentWorker/        # Payment processing (background worker)
│   │   ├── Program.cs
│   │   ├── Receptors/
│   │   │   └── ProcessPaymentReceptor.cs
│   │   └── Workers/
│   │       └── PaymentWorker.cs
│   │
│   ├── ECommerce.ShippingWorker/       # Fulfillment coordination (background worker)
│   │   ├── Program.cs
│   │   ├── Receptors/
│   │   │   └── ShipOrderReceptor.cs
│   │   └── Workers/
│   │       └── ShippingWorker.cs
│   │
│   ├── ECommerce.NotificationWorker/   # Cross-cutting notifications (background worker)
│   │   ├── Program.cs
│   │   ├── Perspectives/               # Listens to ALL events
│   │   │   └── NotificationPerspective.cs
│   │   └── Workers/
│   │       └── NotificationWorker.cs
│   │
│   └── ECommerce.UI/                   # Angular 20 frontend
│       └── (Angular project)
│
├── ECommerce.AppHost/                  # .NET Aspire orchestration
│   └── Program.cs
│
├── tests/
│   ├── ECommerce.OrderService.Tests/
│   ├── ECommerce.InventoryWorker.Tests/
│   └── ECommerce.Integration.Tests/
│
└── ECommerce.sln
```

### Service Responsibilities

| Service | Type | Responsibilities |
|---------|------|------------------|
| **BFF.API** | ASP.NET Core API | UI aggregation, SignalR, read models, GraphQL |
| **OrderService.API** | ASP.NET Core API | Order creation, REST + GraphQL |
| **InventoryWorker** | Background Worker | Inventory reservation, stock management |
| **PaymentWorker** | Background Worker | Payment processing, refunds |
| **ShippingWorker** | Background Worker | Fulfillment coordination |
| **NotificationWorker** | Background Worker | Email, SMS, push notifications |

### Communication Pattern

```
1. UI → BFF.API
   └─> Send CreateOrder command (via HTTP POST)

2. BFF.API → Dispatcher (local)
   └─> LocalInvokeAsync<CreateOrder, OrderCreated>()

3. Receptor → Outbox
   └─> Stores OrderCreated event in outbox

4. WorkCoordinatorPublisher → Azure Service Bus
   └─> Publishes OrderCreated to topic

5. InventoryWorker subscribes to OrderCreated
   └─> Processes event, publishes InventoryReserved

6. PaymentWorker subscribes to InventoryReserved
   └─> Processes event, publishes PaymentProcessed

7. BFF Perspectives subscribe to all events
   └─> Update read models, trigger SignalR updates to UI
```

### .NET Aspire Orchestration

**ECommerce.AppHost/Program.cs**:
```csharp{title=".NET Aspire Orchestration" description="**ECommerce." category="Configuration" difficulty="ADVANCED" tags=["Getting-Started", ".NET", "Aspire", "Orchestration"]}
var builder = DistributedApplication.CreateBuilder(args);

// Infrastructure
var postgres = builder.AddPostgres("postgres")
    .WithPgAdmin()
    .AddDatabase("ecommerce");

var serviceBus = builder.AddAzureServiceBus("servicebus")
    .RunAsEmulator();

// Services
var orderService = builder.AddProject<Projects.ECommerce_OrderService_API>("orderservice")
    .WithReference(postgres)
    .WithReference(serviceBus);

var inventoryWorker = builder.AddProject<Projects.ECommerce_InventoryWorker>("inventoryworker")
    .WithReference(postgres)
    .WithReference(serviceBus);

var paymentWorker = builder.AddProject<Projects.ECommerce_PaymentWorker>("paymentworker")
    .WithReference(postgres)
    .WithReference(serviceBus);

var shippingWorker = builder.AddProject<Projects.ECommerce_ShippingWorker>("shippingworker")
    .WithReference(postgres)
    .WithReference(serviceBus);

var notificationWorker = builder.AddProject<Projects.ECommerce_NotificationWorker>("notificationworker")
    .WithReference(postgres)
    .WithReference(serviceBus);

var bff = builder.AddProject<Projects.ECommerce_BFF_API>("bff")
    .WithReference(postgres)
    .WithReference(serviceBus)
    .WithReference(orderService);

var ui = builder.AddNpmApp("ui", "../ECommerce.UI")
    .WithReference(bff)
    .WithHttpEndpoint(env: "PORT")
    .WithExternalHttpEndpoints();

builder.Build().Run();
```

**Benefits**:
- One-command local development: `dotnet run --project ECommerce.AppHost`
- Automatic service discovery
- Built-in dashboard (http://localhost:15000)
- PostgreSQL and Service Bus emulators
- Health checks and observability

### Pros and Cons

**Pros**:
- ✅ Independent deployment per service
- ✅ Scalability (scale specific services)
- ✅ Team autonomy (own services)
- ✅ Technology diversity (different stacks per service if needed)
- ✅ Fault isolation

**Cons**:
- ❌ Complexity (distributed system challenges)
- ❌ Eventual consistency
- ❌ Debugging across services
- ❌ Infrastructure overhead

---

## Configuration Patterns

### appsettings.json Structure

**Development** (`appsettings.Development.json`):
```json{title="appsettings.json Structure" description="Development (`appsettings." category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Appsettings.json", "Structure"]}
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Whizbang": "Debug",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=myapp;Username=postgres;Password=dev_password"
  },
  "Whizbang": {
    "Outbox": {
      "PollingIntervalMilliseconds": 1000,
      "LeaseSeconds": 300
    },
    "Inbox": {
      "PollingIntervalMilliseconds": 1000
    }
  },
  "AzureServiceBus": {
    "ConnectionString": "Endpoint=sb://localhost;..."
  }
}
```

**Production** (`appsettings.Production.json`):
```json{title="appsettings.json Structure (2)" description="Production (`appsettings." category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Appsettings.json", "Structure"]}
{
  "Logging": {
    "LogLevel": {
      "Default": "Warning",
      "Whizbang": "Information"
    }
  },
  "ConnectionStrings": {
    "DefaultConnection": "${DATABASE_URL}"  // Injected from environment
  },
  "Whizbang": {
    "Outbox": {
      "PollingIntervalMilliseconds": 5000,
      "LeaseSeconds": 600
    }
  },
  "AzureServiceBus": {
    "ConnectionString": "${SERVICE_BUS_CONNECTION_STRING}"
  }
}
```

### Environment Variables

Use environment variables for secrets:

```bash{title="Environment Variables" description="Use environment variables for secrets:" category="Configuration" difficulty="BEGINNER" tags=["Getting-Started", "Environment", "Variables"]}
# .env (local development - NOT committed)
DATABASE_URL=Host=localhost;Database=myapp;Username=postgres;Password=dev_password
SERVICE_BUS_CONNECTION_STRING=Endpoint=sb://localhost;...

# Kubernetes/Docker secrets
kubectl create secret generic myapp-db --from-literal=connection-string="Host=..."
```

---

## Dependency Injection Patterns

### Service Registration Layers

**Layer 1: Whizbang Core**:
```csharp{title="Service Registration Layers" description="Layer 1: Whizbang Core:" category="Configuration" difficulty="BEGINNER" tags=["Getting-Started", "Service", "Registration", "Layers"]}
builder.Services.AddWhizbangCore();  // IDispatcher, MessageEnvelope, etc.
```

**Layer 2: Auto-Discovery** (with Whizbang.Generators):
```csharp{title="Service Registration Layers (2)" description="Layer 2: Auto-Discovery (with Whizbang." category="Configuration" difficulty="BEGINNER" tags=["Getting-Started", "Service", "Registration", "Layers"]}
builder.Services.AddDiscoveredReceptors();      // All IReceptor implementations
builder.Services.AddDiscoveredPerspectives();   // All IPerspectiveOf implementations
```

**Layer 3: Data Access**:
```csharp{title="Service Registration Layers (3)" description="Layer 3: Data Access:" category="Configuration" difficulty="BEGINNER" tags=["Getting-Started", "Service", "Registration", "Layers"]}
builder.Services.AddWhizbangDapper(connectionString);        // Dapper + PostgreSQL
// OR
builder.Services.AddWhizbangEFCore(connectionString);        // EF Core + PostgreSQL
```

**Layer 4: Transports**:
```csharp{title="Service Registration Layers (4)" description="Layer 4: Transports:" category="Configuration" difficulty="BEGINNER" tags=["Getting-Started", "Service", "Registration", "Layers"]}
builder.Services.AddWhizbangAzureServiceBus(
    builder.Configuration.GetSection("AzureServiceBus")
);
```

**Layer 5: Application Services**:
```csharp{title="Service Registration Layers (5)" description="Layer 5: Application Services:" category="Configuration" difficulty="BEGINNER" tags=["Getting-Started", "Service", "Registration", "Layers"]}
builder.Services.AddTransient<IOrderLens, OrderLens>();
builder.Services.AddSingleton<IEmailService, SendGridEmailService>();
```

### Lifetime Guidelines

| Component | Lifetime | Reason |
|-----------|----------|--------|
| `IDispatcher` | Singleton | Shared router, no state |
| `IReceptor<,>` | Transient | May inject scoped services (DbContext) |
| `IPerspectiveOf<>` | Transient | May inject scoped services |
| `ILensQuery` | Transient | Lightweight, may inject scoped services |
| `DbContext` | Scoped | Per-request database context |
| `IDbConnectionFactory` | Singleton | Connection factory (Dapper) |

---

## Testing Structure

### Unit Tests

**Test receptors in isolation**:
```csharp{title="Unit Tests" description="Test receptors in isolation:" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Unit", "Tests"]}
// tests/MyApp.Domain.Tests/Receptors/CreateOrderReceptorTests.cs
public class CreateOrderReceptorTests {
    [Test]
    public async Task HandleAsync_ValidOrder_ReturnsOrderCreatedAsync() {
        // Arrange
        var receptor = new CreateOrderReceptor(/* mock dependencies */);
        var command = new CreateOrder(/* ... */);

        // Act
        var result = await receptor.HandleAsync(command);

        // Assert
        await Assert.That(result.OrderId).IsNotEqualTo(Guid.Empty);
    }
}
```

### Integration Tests

**Test full message flow**:
```csharp{title="Integration Tests" description="Test full message flow:" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Integration", "Tests"]}
// tests/MyApp.Integration.Tests/OrderWorkflowTests.cs
public class OrderWorkflowTests {
    private WebApplicationFactory<Program> _factory;
    private IDispatcher _dispatcher;

    [Before(Test)]
    public async Task SetupAsync() {
        _factory = new WebApplicationFactory<Program>();
        _dispatcher = _factory.Services.GetRequiredService<IDispatcher>();
    }

    [Test]
    public async Task CreateOrder_FullWorkflow_UpdatesReadModelAsync() {
        // Arrange
        var command = new CreateOrder(/* ... */);

        // Act - dispatch command
        var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);

        // Publish event to perspectives
        await _dispatcher.PublishAsync(result);

        // Assert - query read model
        var lens = _factory.Services.GetRequiredService<IOrderLens>();
        var order = await lens.GetOrderAsync(result.OrderId);

        await Assert.That(order).IsNotNull();
        await Assert.That(order!.Status).IsEqualTo("Created");
    }
}
```

---

## Migration Paths

### Single → Clean Architecture

1. Create `MyApp.Messages` project
2. Move commands/events to Messages project
3. Create `MyApp.Domain` project
4. Move receptors to Domain project
5. Create `MyApp.ReadModels` project
6. Move perspectives/lenses to ReadModels project
7. Update API project to reference Domain + ReadModels

**Timeline**: 1-2 hours for small app

### Clean Architecture → Microservices

1. Identify service boundaries (order, inventory, payment, etc.)
2. Create service projects (API or Worker)
3. Add transport (Azure Service Bus)
4. Implement Outbox/Inbox patterns
5. Split receptors across services
6. Create BFF for UI aggregation
7. Add .NET Aspire AppHost for orchestration

**Timeline**: 1-2 weeks for initial split, iterative refinement

---

## Best Practices

### DO ✅

- ✅ Use central package management (`Directory.Packages.props`)
- ✅ Use shared build properties (`Directory.Build.props`)
- ✅ Keep messages in separate project (no dependencies)
- ✅ Use auto-discovery for receptors/perspectives (Whizbang.Generators)
- ✅ Follow namespace conventions (Messages.Commands, Messages.Events)
- ✅ Use environment-specific appsettings
- ✅ Keep receptors stateless
- ✅ Test receptors in isolation

### DON'T ❌

- ❌ Put business logic in controllers/endpoints
- ❌ Create circular dependencies between projects
- ❌ Reference domain projects from Messages project
- ❌ Hard-code connection strings
- ❌ Share database contexts across services
- ❌ Use static state in receptors
- ❌ Mix read and write logic in same class

---

## Example: Adding a New Feature

**Scenario**: Add "Cancel Order" feature to Clean Architecture app

### Step 1: Define Message

```csharp{title="Step 1: Define Message" description="Demonstrates step 1: Define Message" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Step", "Define", "Message"]}
// MyApp.Messages/Commands/CancelOrder.cs
public record CancelOrder(
    Guid OrderId,
    string Reason
);

// MyApp.Messages/Events/OrderCancelled.cs
public record OrderCancelled(
    Guid OrderId,
    string Reason,
    DateTimeOffset CancelledAt
);
```

### Step 2: Create Receptor

```csharp{title="Step 2: Create Receptor" description="Demonstrates step 2: Create Receptor" category="Configuration" difficulty="ADVANCED" tags=["Getting-Started", "Step", "Create", "Receptor"]}
// MyApp.Domain/Receptors/CancelOrderReceptor.cs
using Whizbang.Core;
using MyApp.Messages.Commands;
using MyApp.Messages.Events;

public class CancelOrderReceptor : IReceptor<CancelOrder, OrderCancelled> {
    private readonly IDbConnectionFactory _db;

    public CancelOrderReceptor(IDbConnectionFactory db) {
        _db = db;
    }

    public async ValueTask<OrderCancelled> HandleAsync(
        CancelOrder message,
        CancellationToken ct = default) {

        // Validation
        await using var conn = _db.CreateConnection();
        var order = await conn.QuerySingleOrDefaultAsync<Order>(
            "SELECT * FROM orders WHERE order_id = @OrderId",
            new { message.OrderId }
        );

        if (order is null) {
            throw new InvalidOperationException($"Order {message.OrderId} not found");
        }

        if (order.Status == "Shipped") {
            throw new InvalidOperationException("Cannot cancel shipped order");
        }

        // Return event
        return new OrderCancelled(
            OrderId: message.OrderId,
            Reason: message.Reason,
            CancelledAt: DateTimeOffset.UtcNow
        );
    }
}
```

### Step 3: Update Perspective

```csharp{title="Step 3: Update Perspective" description="Demonstrates step 3: Update Perspective" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Step", "Update", "Perspective"]}
// MyApp.ReadModels/Perspectives/OrderSummaryPerspective.cs
public class OrderSummaryPerspective :
    IPerspectiveOf<OrderCreated>,
    IPerspectiveOf<OrderCancelled> {  // Add new event

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        // Existing logic
    }

    public async Task UpdateAsync(OrderCancelled @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE order_summaries SET status = 'Cancelled', cancelled_at = @CancelledAt WHERE order_id = @OrderId",
            new { @event.OrderId, @event.CancelledAt }
        );
    }
}
```

### Step 4: Add Endpoint

```csharp{title="Step 4: Add Endpoint" description="Demonstrates step 4: Add Endpoint" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Step", "Add", "Endpoint"]}
// MyApp.API/Endpoints/OrdersController.cs
[HttpPost("{orderId:guid}/cancel")]
public async Task<ActionResult> CancelOrder(
    Guid orderId,
    [FromBody] CancelOrderRequest request,
    CancellationToken ct) {

    var command = new CancelOrder(orderId, request.Reason);

    var result = await _dispatcher.LocalInvokeAsync<CancelOrder, OrderCancelled>(command, ct);
    await _dispatcher.PublishAsync(result, ct);

    return Ok(result);
}
```

### Step 5: Test

```csharp{title="Step 5: Test" description="Demonstrates step 5: Test" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Step", "Test"]}
// MyApp.Domain.Tests/Receptors/CancelOrderReceptorTests.cs
[Test]
public async Task HandleAsync_ValidOrder_ReturnsOrderCancelledAsync() {
    // Arrange
    var receptor = new CancelOrderReceptor(mockDb);
    var command = new CancelOrder(Guid.NewGuid(), "Customer request");

    // Act
    var result = await receptor.HandleAsync(command);

    // Assert
    await Assert.That(result.Reason).IsEqualTo("Customer request");
}
```

**Done!** Auto-discovery registers the receptor automatically on next build.

---

## Further Reading

**Architecture Patterns**:
- [Core Concepts: Dispatcher](../fundamentals/dispatcher/dispatcher.md)
- [Core Concepts: Receptors](../fundamentals/receptors/receptors.md)
- [Core Concepts: Perspectives](../fundamentals/perspectives/perspectives.md)

**Messaging**:
- [Outbox Pattern](../messaging/outbox-pattern.md)
- [Inbox Pattern](../messaging/inbox-pattern.md)
- [Work Coordination](../messaging/work-coordinator.md)

**Examples**:
- [ECommerce Sample Overview](../examples/ecommerce/overview.md)
- [BFF Pattern](../examples/ecommerce/bff-pattern.md)

---

**Next**: Dive into [Core Concepts: Dispatcher](../fundamentals/dispatcher/dispatcher.md) to master message routing patterns.

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
