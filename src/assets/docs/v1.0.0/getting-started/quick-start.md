---
title: Quick Start Tutorial
pageType: tutorial
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Getting Started
order: 3
description: >-
  Build your first Whizbang application in 10 minutes - create messages,
  receptors, and dispatch commands with complete working examples
tags: 'quick-start, tutorial, beginner, hello-world'
codeReferences:
  - samples/ECommerce/ECommerce.Contracts/Commands/CreateOrderCommand.cs
  - samples/ECommerce/ECommerce.OrderService.API/Receptors/CreateOrderReceptor.cs
  - samples/ECommerce/ECommerce.OrderService.API/Program.cs
  - samples/ECommerce/ECommerce.OrderService.API/OrderDbContext.cs
testReferences:
  - samples/ECommerce/ECommerce.Contracts.Tests/Commands/CreateProductCommandTests.cs
  - tests/Whizbang.Core.Tests/Receptors/ReceptorTests.cs
lastMaintainedCommit: '01f07906'
---

# Quick Start Tutorial

Build your first Whizbang application in **10 minutes**. This tutorial walks you through creating a simple order management system using Whizbang's core patterns. It mirrors the structure of the [ECommerce sample](https://github.com/whizbang-lib/whizbang/tree/main/samples/ECommerce) that ships with the library.

## What You'll Build

A minimal ASP.NET Core API that:
- Accepts **CreateOrder** commands via HTTP endpoint
- Processes orders using a **Receptor** (message handler)
- Returns **OrderCreated** events with validation
- Uses **Dispatcher** for type-safe message routing
- Persists framework state (event store, outbox, inbox) via the **EF Core Postgres driver**

**Prerequisites**: Complete the [Installation Guide](installation.md) first. Docker is required for PostgreSQL and RabbitMQ.

## Step 1: Create Project Structure

```bash{title="Step 1: Create Project Structure" description="Step 1: Create Project Structure" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Bash", "Step", "Create", "Project"]}
# Create solution and project
dotnet new sln -n QuickStartApp
dotnet new webapi -n QuickStartApp.API
dotnet sln add QuickStartApp.API

cd QuickStartApp.API

# Add Whizbang packages
dotnet add package Whizbang.Core
dotnet add package Whizbang.Generators
dotnet add package Whizbang.Data.EFCore.Postgres
dotnet add package Whizbang.Transports.RabbitMQ
```

## Step 2: Start Infrastructure (Docker)

Whizbang's Postgres driver stores the event store, outbox, and inbox in PostgreSQL; RabbitMQ is the local-development transport:

```bash{title="Step 2: Start Infrastructure" description="Start PostgreSQL and RabbitMQ containers" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Bash", "Step", "Docker", "Infrastructure"]}
docker run -d --name quickstart-postgres \
  -e POSTGRES_PASSWORD=dev_password \
  -e POSTGRES_DB=quickstart \
  -p 5432:5432 \
  postgres:16

docker run -d --name quickstart-rabbitmq \
  -p 5672:5672 -p 15672:15672 \
  rabbitmq:3-management
```

Add connection strings to **appsettings.Development.json**:

```json{title="Step 2: Connection Strings" description="Configure connection strings" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Json", "Step", "Connection", "Strings"]}
{
  "ConnectionStrings": {
    "postgres": "Host=localhost;Database=quickstart;Username=postgres;Password=dev_password",
    "rabbitmq": "amqp://guest:guest@localhost:5672"
  }
}
```

## Step 3: Define Your Messages

Create a `Messages` folder and define your command and event. Commands implement `ICommand`, events implement `IEvent`, and the `[StreamId]` attribute marks the property that identifies the event stream:

**Messages/CreateOrder.cs**:
```csharp{title="Step 3: Define Your Messages" description="**Messages/CreateOrder." category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "C#", "Step", "Define", "Your"] unverified="sample project — this command-record definition is the tutorial analog of CreateProductCommand, exercised by CreateProductCommandTests, which is outside the current coverage map"}
using Whizbang.Core;

namespace QuickStartApp.API.Messages;

public record CreateOrder(
    [property: StreamId] Guid OrderId,
    Guid CustomerId,
    string ProductName,
    int Quantity,
    decimal UnitPrice
) : ICommand;
```

**Messages/OrderCreated.cs**:
```csharp{title="Step 3: Define Your Messages - OrderCreated" description="**Messages/OrderCreated." category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-started", "C#", "Step", "Define", "Your"] unverified="user domain event definition — illustrative record, not exercised by a test"}
using Whizbang.Core;

namespace QuickStartApp.API.Messages;

public record OrderCreated(
    [property: StreamId] Guid OrderId,
    Guid CustomerId,
    string ProductName,
    int Quantity,
    decimal UnitPrice,
    decimal Total,
    DateTimeOffset CreatedAt
) : IEvent;
```

**Key Points**:
- Use **records** for immutability and value semantics
- Commands are **requests** (CreateOrder) and implement `ICommand`
- Events are **facts** (OrderCreated - past tense) and implement `IEvent`
- `[StreamId]` identifies which event stream the message belongs to
- Include all necessary data for downstream consumers

## Step 4: Create Your First Receptor

Receptors are **stateless message handlers** that implement business logic.

**Receptors/CreateOrderReceptor.cs**:
```csharp{title="Step 4: Create Your First Receptor" description="**Receptors/CreateOrderReceptor." category="Configuration" difficulty="ADVANCED" tags=["Getting-started", "C#", "Step", "Create", "Your"] tests=["ReceptorTests.Receive_ValidCommand_ShouldReturnTypeSafeResponseAsync", "ReceptorTests.Receive_EmptyItems_ShouldThrowExceptionAsync", "ReceptorTests.Receive_CalculatesTotal_ShouldSumItemPricesAsync", "ReceptorTests.Receptor_ShouldBeStateless_NoPersistentStateAsync"]}
using Whizbang.Core;
using QuickStartApp.API.Messages;

namespace QuickStartApp.API.Receptors;

public class CreateOrderReceptor(ILogger<CreateOrderReceptor> logger)
    : IReceptor<CreateOrder, OrderCreated> {

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {

        // Validation
        if (message.Quantity <= 0) {
            throw new InvalidOperationException("Quantity must be greater than zero");
        }

        if (message.UnitPrice <= 0) {
            throw new InvalidOperationException("Unit price must be greater than zero");
        }

        if (string.IsNullOrWhiteSpace(message.ProductName)) {
            throw new InvalidOperationException("Product name is required");
        }

        // Business logic
        var total = message.Quantity * message.UnitPrice;

        logger.LogInformation(
            "Creating order {OrderId} for customer {CustomerId}: {Quantity}x {ProductName} = {Total:C}",
            message.OrderId, message.CustomerId, message.Quantity, message.ProductName, total
        );

        // Return event (fact of what happened) - it cascades to the
        // event store / outbox automatically
        return new OrderCreated(
            OrderId: message.OrderId,
            CustomerId: message.CustomerId,
            ProductName: message.ProductName,
            Quantity: message.Quantity,
            UnitPrice: message.UnitPrice,
            Total: total,
            CreatedAt: DateTimeOffset.UtcNow
        );
    }
}
```

**Key Patterns**:
- Implement `IReceptor<TMessage, TResponse>`
- Use constructor injection for dependencies (primary constructors work well)
- Validate inputs and throw exceptions for invalid requests
- Return domain events (OrderCreated) describing what happened
- Use `ValueTask<T>` for performance (may be synchronous or async)

## Step 5: Add the DbContext and Register Whizbang

Create a partial `DbContext` marked with `[WhizbangDbContext]`. Source generators add the Inbox/Outbox/EventStore `DbSet`s and the schema-initialization extension:

**AppDbContext.cs**:
```csharp{title="Step 5: DbContext" description="**AppDbContext." category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-started", "C#", "Step", "DbContext", "Whizbang"] unverified="project scaffolding — not exercised by a test"}
using Microsoft.EntityFrameworkCore;
using Whizbang.Data.EFCore.Custom;

namespace QuickStartApp.API;

[WhizbangDbContext]
public partial class AppDbContext(DbContextOptions<AppDbContext> options)
    : DbContext(options) {
    // DbSet properties and OnModelCreating are auto-generated in a partial class
}
```

Configure dependency injection in **Program.cs**:

```csharp{title="Step 5: Register Whizbang Services" description="Configure dependency injection in **Program." category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-started", "C#", "Step", "Register", "Whizbang"] unverified="project scaffolding — DI wiring in Program.cs, not exercised by a test"}
using Microsoft.EntityFrameworkCore;
using QuickStartApp.API;
using QuickStartApp.API.Generated;
using Whizbang.Core;
using Whizbang.Core.Generated;
using Whizbang.Core.Messaging;
using Whizbang.Core.Observability;
using Whizbang.Data.EFCore.Postgres;
using Whizbang.Transports.RabbitMQ;

var builder = WebApplication.CreateBuilder(args);

var postgresConnection = builder.Configuration.GetConnectionString("postgres")!;
var rabbitMqConnection = builder.Configuration.GetConnectionString("rabbitmq")!;

// Transport (RabbitMQ for local development)
builder.Services.AddRabbitMQTransport(rabbitMqConnection);
builder.Services.AddRabbitMQHealthChecks();

// Observability + worker prerequisites (mirrors samples/ECommerce)
builder.Services.AddSingleton<ITraceStore, InMemoryTraceStore>();
builder.Services.AddSingleton<IServiceInstanceProvider, ServiceInstanceProvider>();
builder.Services.AddSingleton<OrderedStreamProcessor>();

// EF Core DbContext for Inbox/Outbox/EventStore
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(postgresConnection));

// Unified Whizbang API with the EF Core Postgres driver
builder.Services
    .AddWhizbang()
    .WithEFCore<AppDbContext>()
    .WithDriver.Postgres;

// Generated registrations (produced by Whizbang.Generators)
builder.Services.AddReceptors();
builder.Services.AddWhizbangDispatcher();

// Controllers
builder.Services.AddControllers();

var app = builder.Build();

// Initialize Whizbang database schema on startup (generated, idempotent)
using (var scope = app.Services.CreateScope()) {
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    await dbContext.EnsureWhizbangDatabaseInitializedAsync(logger);
}

app.MapControllers();

app.Run();
```

**Important**:
- `AddWhizbang().WithEFCore<AppDbContext>().WithDriver.Postgres` registers the dispatcher infrastructure, `IInbox`, `IOutbox`, `IEventStore`, background workers, and per-model lenses
- `AddReceptors()` and `AddWhizbangDispatcher()` are **generated** extension methods - they appear after your first build (in the `QuickStartApp.API.Generated` / `Whizbang.Core.Generated` namespaces)
- `EnsureWhizbangDatabaseInitializedAsync()` creates all `wh_*` tables and PostgreSQL functions; it is idempotent and safe on every startup

## Step 6: Create API Endpoint

Create a controller to dispatch your command:

**Controllers/OrdersController.cs**:
```csharp{title="Step 6: Create API Endpoint" description="**Controllers/OrdersController." category="Configuration" difficulty="ADVANCED" tags=["Getting-started", "C#", "Step", "Create", "API"] unverified="project scaffolding — HTTP controller and dispatch wiring, not exercised by a test"}
using Microsoft.AspNetCore.Mvc;
using Whizbang.Core;
using Whizbang.Core.ValueObjects;
using QuickStartApp.API.Messages;

namespace QuickStartApp.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase {
    private readonly IDispatcher _dispatcher;
    private readonly ILogger<OrdersController> _logger;

    public OrdersController(IDispatcher dispatcher, ILogger<OrdersController> logger) {
        _dispatcher = dispatcher;
        _logger = logger;
    }

    [HttpPost]
    public async Task<ActionResult<OrderCreated>> CreateOrder(
        [FromBody] CreateOrderRequest request) {

        try {
            var command = new CreateOrder(
                OrderId: TrackedGuid.NewMedo(),  // time-ordered UUIDv7
                CustomerId: request.CustomerId,
                ProductName: request.ProductName,
                Quantity: request.Quantity,
                UnitPrice: request.UnitPrice
            );

            // Dispatch command and get typed result (< 20ns dispatch overhead)
            var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);

            _logger.LogInformation("Order {OrderId} created successfully", result.OrderId);

            return CreatedAtAction(
                nameof(GetOrder),
                new { orderId = result.OrderId },
                result
            );
        } catch (InvalidOperationException ex) {
            _logger.LogWarning(ex, "Invalid order request");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpGet("{orderId:guid}")]
    public ActionResult<OrderCreated> GetOrder(Guid orderId) {
        // Placeholder - in a real app, query the read model via ILensQuery<T>
        return NotFound(new { error = "Order retrieval not implemented in quick start" });
    }
}

// Request DTO for API
public record CreateOrderRequest(
    Guid CustomerId,
    string ProductName,
    int Quantity,
    decimal UnitPrice
);
```

**Key Patterns**:
- Inject `IDispatcher` into your controller/endpoint
- Use `LocalInvokeAsync<TMessage, TResponse>` for **in-process** dispatch with typed result
- Generate stream IDs with `TrackedGuid.NewMedo()` (time-ordered UUIDv7)
- Handle exceptions from receptors (validation errors, business rule violations)
- Return appropriate HTTP status codes (201 Created, 400 Bad Request)

## Step 7: Run and Test

### Start the Application

```bash{title="Start the Application" description="Start the Application" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Bash", "Start", "Application"]}
dotnet run
```

Watch the logs - on first startup Whizbang initializes its schema (you'll see the `wh_*` tables created in the `quickstart` database).

### Test with curl

**Valid request** (use the HTTP port from your launch profile):
```bash{title="Test with curl" description="Valid request:" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Bash", "Test"]}
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "550e8400-e29b-41d4-a716-446655440000",
    "productName": "Laptop",
    "quantity": 2,
    "unitPrice": 999.99
  }'
```

**Expected response** (201 Created):
```json{title="Test with curl (2)" description="Expected response (201 Created):" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-started", "Json", "Test"]}
{
  "orderId": "018d8f8e-1234-7890-abcd-ef1234567890",
  "customerId": "550e8400-e29b-41d4-a716-446655440000",
  "productName": "Laptop",
  "quantity": 2,
  "unitPrice": 999.99,
  "total": 1999.98,
  "createdAt": "2026-07-16T10:30:00Z"
}
```

**Invalid request** (negative quantity):
```bash{title="Test with curl (3)" description="Invalid request (negative quantity):" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Bash", "Test"]}
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "550e8400-e29b-41d4-a716-446655440000",
    "productName": "Laptop",
    "quantity": -5,
    "unitPrice": 999.99
  }'
```

**Expected response** (400 Bad Request):
```json{title="Test with curl (4)" description="Expected response (400 Bad Request):" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Json", "Test"]}
{
  "error": "Quantity must be greater than zero"
}
```

### Verify the Event Store

```bash{title="Verify the Event Store" description="Query the event store table:" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Bash", "Verify", "Event", "Store"]}
docker exec quickstart-postgres psql -U postgres -d quickstart \
  -c "SELECT event_type, stream_id, version FROM wh_event_store ORDER BY created_at;"
```

## What You Just Built

Congratulations! You've created a working Whizbang application with:

✅ **Type-safe messaging** - Compiler enforces CreateOrder → OrderCreated
✅ **Zero reflection** - All routing happens at compile time
✅ **Durable events** - OrderCreated lands in `wh_event_store` automatically
✅ **Clean architecture** - Commands, events, and handlers are separated
✅ **Business logic isolation** - Validation and rules in receptor, not controller

## Understanding the Flow

```
HTTP POST /api/orders
    ↓
OrdersController.CreateOrder()
    ↓
dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command)
    ↓
CreateOrderReceptor.HandleAsync(command)
    ↓
Validation → Business Logic → Return OrderCreated event
    ↓
Event cascades to event store / outbox (background workers publish it)
    ↓
Return 201 Created with OrderCreated response
```

## Next Steps

### Add Perspectives (Read Models)

Perspectives are **pure functions** that fold events into read models. The framework persists the model (in a `wh_per_*` table) and tracks progress per stream - your code never touches the database:

**Perspectives/OrderSummaryPerspective.cs**:
```csharp{title="Add Perspectives (Read Models)" description="**Perspectives/OrderSummaryPerspective." category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-started", "C#", "Add", "Perspectives", "Read"] unverified="user domain perspective definition — illustrative next-step, not exercised by this page's tests"}
using Whizbang.Core;
using Whizbang.Core.Perspectives;
using QuickStartApp.API.Messages;

namespace QuickStartApp.API.Perspectives;

public sealed record OrderSummary {
    [StreamId]
    public Guid OrderId { get; init; }
    public Guid CustomerId { get; init; }
    public string ProductName { get; init; } = "";
    public decimal Total { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
}

public class OrderSummaryPerspective : IPerspectiveFor<OrderSummary, OrderCreated> {
    public OrderSummary Apply(OrderSummary currentData, OrderCreated eventData) =>
        currentData with {
            OrderId = eventData.OrderId,
            CustomerId = eventData.CustomerId,
            ProductName = eventData.ProductName,
            Total = eventData.Total,
            CreatedAt = eventData.CreatedAt
        };
}
```

Perspectives are discovered by source generators - no manual registration. Query the read model through the automatically registered lens:

```csharp{title="Add Perspectives (Read Models) (2)" description="Query via lens:" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "C#", "Add", "Perspectives", "Read"] unverified="lens query illustration — not exercised by a test"}
[HttpGet("{orderId:guid}")]
public async Task<ActionResult<OrderSummary>> GetOrder(
    Guid orderId,
    [FromServices] ILensQuery<OrderSummary> lens) {

    var order = await lens.DefaultScope.GetByIdAsync(orderId);
    return order is null ? NotFound() : Ok(order);
}
```

See the [Perspectives Guide](../fundamentals/perspectives/perspectives.md) for multi-event perspectives, actions, and rebuild.

### Add Tests

Whizbang uses **TUnit** for testing. Create a test project and reference your API:

```bash{title="Add Tests" description="Install testing packages:" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Bash", "Add", "Tests"]}
dotnet new classlib -n QuickStartApp.API.Tests
cd QuickStartApp.API.Tests
dotnet add package TUnit
dotnet add reference ../QuickStartApp.API
```

TUnit runs on Microsoft.Testing.Platform, so the test project must be executable (this mirrors the library's own test projects):

```xml{title="Add Tests (2)" description="Test project setup:" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Xml", "Add", "Tests"]}
<!-- QuickStartApp.API.Tests.csproj -->
<PropertyGroup>
  <OutputType>Exe</OutputType>
  <IsPackable>false</IsPackable>
</PropertyGroup>
```

Test your receptor directly - receptors are plain classes:

```csharp{title="Add Tests - CreateOrderReceptorTests" description="Test your receptor:" category="Configuration" difficulty="ADVANCED" tags=["Getting-started", "C#", "Add", "Tests", "CreateOrderReceptorTests"] unverified="tutorial test example — CreateOrderReceptorTests is illustrative and not part of the coverage map"}
using Microsoft.Extensions.Logging.Abstractions;
using Whizbang.Core.ValueObjects;
using QuickStartApp.API.Messages;
using QuickStartApp.API.Receptors;

public class CreateOrderReceptorTests {
    [Test]
    public async Task HandleAsync_ValidOrder_ReturnsOrderCreatedAsync() {
        // Arrange
        var receptor = new CreateOrderReceptor(NullLogger<CreateOrderReceptor>.Instance);

        var command = new CreateOrder(
            OrderId: TrackedGuid.NewMedo(),
            CustomerId: TrackedGuid.NewMedo(),
            ProductName: "Test Product",
            Quantity: 5,
            UnitPrice: 19.99m
        );

        // Act
        var result = await receptor.HandleAsync(command);

        // Assert
        await Assert.That(result.OrderId).IsEqualTo(command.OrderId);
        await Assert.That(result.CustomerId).IsEqualTo(command.CustomerId);
        await Assert.That(result.ProductName).IsEqualTo("Test Product");
        await Assert.That(result.Quantity).IsEqualTo(5);
        await Assert.That(result.UnitPrice).IsEqualTo(19.99m);
        await Assert.That(result.Total).IsEqualTo(99.95m);
    }

    [Test]
    public async Task HandleAsync_InvalidQuantity_ThrowsExceptionAsync() {
        // Arrange
        var receptor = new CreateOrderReceptor(NullLogger<CreateOrderReceptor>.Instance);

        var command = new CreateOrder(
            OrderId: TrackedGuid.NewMedo(),
            CustomerId: TrackedGuid.NewMedo(),
            ProductName: "Test Product",
            Quantity: -1, // Invalid
            UnitPrice: 19.99m
        );

        // Act & Assert
        await Assert.That(async () => await receptor.HandleAsync(command))
            .Throws<InvalidOperationException>();
    }
}
```

Run tests:
```bash{title="Add Tests (3)" description="Add Tests (3)" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "Bash", "Add", "Tests"]}
dotnet test
```

**Testing tips**: never use `Task.Delay`/polling in tests — use completion signals. For integration tests, `.WithDriver.InMemory` swaps the Postgres driver for an in-memory one.

### Explore the ECommerce Sample

The complete ECommerce sample demonstrates:
- **Backend for Frontend (BFF)** with SignalR real-time updates
- **Microservices** architecture (Order, Inventory, Payment, Shipping, Notification)
- **Event-driven workflows** with Outbox/Inbox patterns
- **.NET Aspire orchestration** for local development
- **Angular UI** with NgRx state management
- **Integration testing** with TUnit

See [ECommerce Tutorial](../../drafts/metrics/overview.md) for complete walkthrough.

## Common Patterns

### Pattern 1: Command → Event
```csharp{title="Pattern 1: Command → Event" description="Pattern 1: Command → Event" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "C#", "Pattern", "Command", "Event"] unverified="conceptual flow illustration — not executable code"}
CreateOrder (command) → CreateOrderReceptor → OrderCreated (event)
```
- Commands express **intent** (imperative: "create order")
- Events express **facts** (past tense: "order created")
- Receptors make **decisions** and return events

### Pattern 2: Event → Perspectives
```csharp{title="Pattern 2: Event → Perspectives" description="Pattern 2: Event → Perspectives" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "C#", "Pattern", "Event", "Perspectives"] unverified="conceptual flow illustration — not executable code"}
OrderCreated (event) → OrderSummaryPerspective.Apply → wh_per_order_summary
                     → InventoryPerspective.Apply    → wh_per_inventory
                     → AnalyticsPerspective.Apply    → wh_per_analytics
```
- One event can feed multiple perspectives
- Perspectives are **pure functions** - the framework persists the results
- Perspectives are **eventually consistent**

### Pattern 3: Query via Lenses
```csharp{title="Pattern 3: Query via Lenses" description="Pattern 3: Query via Lenses" category="Configuration" difficulty="BEGINNER" tags=["Getting-started", "C#", "Pattern", "Query"] unverified="conceptual flow illustration — not executable code"}
GET /api/orders/{id} → ILensQuery<OrderSummary> → wh_per_* table → Return model
```
- `ILensQuery<TModel>` is registered automatically per perspective model
- Use `.DefaultScope.GetByIdAsync(id)` or `.DefaultScope.Query` (LINQ)
- Fast, indexed reads over denormalized JSONB rows

## Troubleshooting

### Issue: "No receptor registered for CreateOrder"

**Symptom**: Runtime exception when calling `LocalInvokeAsync`

**Solution**:
1. Verify the generated registrations are called in `Program.cs`:
   ```csharp
   builder.Services.AddReceptors();
   builder.Services.AddWhizbangDispatcher();
   ```
2. Rebuild so the generators re-run: `dotnet clean && dotnet build`

### Issue: "Type 'IDispatcher' not found"

**Symptom**: Compiler error when injecting IDispatcher

**Solution**:
1. Add using directive:
   ```csharp
   using Whizbang.Core;
   ```
2. Verify package reference:
   ```bash
   dotnet list package | grep Whizbang.Core
   ```
3. Restore if missing:
   ```bash
   dotnet restore
   ```

### Issue: Generated files not appearing

**Symptom**: `AddReceptors()` / `EnsureWhizbangDatabaseInitializedAsync()` don't exist, or no files in `.whizbang/cache/`

**Solution**:
1. Ensure the `Whizbang.Generators` package is referenced (and `Whizbang.Data.EFCore.Postgres` for the DbContext extension)
2. To inspect generated sources on disk, add MSBuild properties in `.csproj`:
   ```xml
   <PropertyGroup>
     <EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
     <CompilerGeneratedFilesOutputPath>$(MSBuildProjectDirectory)/.whizbang/cache</CompilerGeneratedFilesOutputPath>
   </PropertyGroup>
   ```
3. Rebuild:
   ```bash
   dotnet clean && dotnet build
   ```

## Key Takeaways

🎯 **Receptors** handle commands and return events
🎯 **Dispatcher** routes messages with compile-time type safety
🎯 **Zero Reflection** - all wiring happens via source generators
🎯 **Durable by default** - events cascade to `wh_event_store` and the outbox
🎯 **Pure perspectives** - read models are folds over events, persisted by the framework

## Further Reading

**Core Concepts**:
- [Dispatcher Deep Dive](../fundamentals/dispatcher/dispatcher.md) - Three dispatch patterns explained
- [Receptors Guide](../fundamentals/receptors/receptors.md) - Advanced receptor patterns
- [Perspectives Guide](../fundamentals/perspectives/perspectives.md) - Building read models
- [Lenses Guide](../fundamentals/lenses/lenses.md) - Query optimization

**Messaging Patterns**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable cross-service messaging
- [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once message processing
- [Work Coordination](../messaging/work-coordinator.md) - Distributed work coordination

**Advanced Topics**:
- [Source Generators](../extending/source-generators/receptor-discovery.md) - Auto-discovery internals
- Performance Tuning - Optimize for scale
- Testing Strategies - Comprehensive testing guide

---

**Next**: [Project Structure Guide](project-structure.md) - Organize your Whizbang application

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
