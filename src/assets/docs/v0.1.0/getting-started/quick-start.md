---
title: "Quick Start Tutorial"
version: 0.1.0
category: Getting Started
order: 3
description: "Build your first Whizbang application in 10 minutes - create messages, receptors, and dispatch commands with complete working examples"
tags: quick-start, tutorial, beginner, hello-world
codeReferences:
  - samples/ECommerce/ECommerce.Messages/Commands/CreateOrder.cs
  - samples/ECommerce/ECommerce.OrderService.API/Receptors/CreateOrderReceptor.cs
  - samples/ECommerce/ECommerce.BFF.API/Program.cs
---

# Quick Start Tutorial

Build your first Whizbang application in **10 minutes**. This tutorial walks you through creating a simple order management system using Whizbang's core patterns.

## What You'll Build

A minimal ASP.NET Core API that:
- Accepts **CreateOrder** commands via HTTP endpoint
- Processes orders using a **Receptor** (message handler)
- Returns **OrderCreated** events with validation
- Uses **Dispatcher** for type-safe message routing

**Prerequisites**: Complete the [Installation Guide](installation.md) first.

## Step 1: Create Project Structure

```bash
# Create solution and project
dotnet new sln -n QuickStartApp
dotnet new webapi -n QuickStartApp.API
dotnet sln add QuickStartApp.API

cd QuickStartApp.API

# Add Whizbang packages
dotnet add package Whizbang.Core
dotnet add package Whizbang.Generators
```

## Step 2: Define Your Messages

Create a `Messages` folder and define your command and event:

**Messages/CreateOrder.cs**:
```csharp
namespace QuickStartApp.API.Messages;

public record CreateOrder(
    Guid CustomerId,
    string ProductName,
    int Quantity,
    decimal UnitPrice
);
```

**Messages/OrderCreated.cs**:
```csharp
namespace QuickStartApp.API.Messages;

public record OrderCreated(
    Guid OrderId,
    Guid CustomerId,
    string ProductName,
    int Quantity,
    decimal UnitPrice,
    decimal Total,
    DateTimeOffset CreatedAt
);
```

**Key Points**:
- Use **records** for immutability and value semantics
- Commands are **requests** (CreateOrder)
- Events are **facts** (OrderCreated - past tense)
- Include all necessary data for downstream consumers

## Step 3: Create Your First Receptor

Receptors are **stateless message handlers** that implement business logic.

**Receptors/CreateOrderReceptor.cs**:
```csharp
using Whizbang.Core;
using QuickStartApp.API.Messages;

namespace QuickStartApp.API.Receptors;

public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly ILogger<CreateOrderReceptor> _logger;

    public CreateOrderReceptor(ILogger<CreateOrderReceptor> logger) {
        _logger = logger;
    }

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
        var orderId = Guid.CreateVersion7(); // Time-ordered GUID
        var total = message.Quantity * message.UnitPrice;

        _logger.LogInformation(
            "Creating order {OrderId} for customer {CustomerId}: {Quantity}x {ProductName} = {Total:C}",
            orderId, message.CustomerId, message.Quantity, message.ProductName, total
        );

        // Return event (fact of what happened)
        return new OrderCreated(
            OrderId: orderId,
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
- Use constructor injection for dependencies
- Validate inputs and throw exceptions for invalid requests
- Return domain events (OrderCreated) describing what happened
- Use `ValueTask<T>` for performance (may be synchronous or async)

## Step 4: Register Whizbang Services

Configure dependency injection in **Program.cs**:

```csharp
using Whizbang.Core;
using QuickStartApp.API.Messages;
using QuickStartApp.API.Receptors;

var builder = WebApplication.CreateBuilder(args);

// Add Whizbang Core
builder.Services.AddWhizbangCore();

// Register receptors manually (or use Whizbang.Generators for auto-discovery)
builder.Services.AddTransient<IReceptor<CreateOrder, OrderCreated>, CreateOrderReceptor>();

// Add controllers (if using MVC/API)
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

**Important**:
- `AddWhizbangCore()` registers the dispatcher and core services
- Receptors can be registered manually or auto-discovered (with Whizbang.Generators)
- Receptors are typically **transient** (new instance per request)

## Step 5: Create API Endpoint

Create a minimal API endpoint to dispatch your command:

**Endpoints/OrderEndpoints.cs**:
```csharp
using Microsoft.AspNetCore.Mvc;
using Whizbang.Core;
using QuickStartApp.API.Messages;

namespace QuickStartApp.API.Endpoints;

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
        [FromBody] CreateOrderRequest request,
        CancellationToken cancellationToken) {

        try {
            var command = new CreateOrder(
                CustomerId: request.CustomerId,
                ProductName: request.ProductName,
                Quantity: request.Quantity,
                UnitPrice: request.UnitPrice
            );

            // Dispatch command and get typed result (< 20ns, zero allocation)
            var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
                command,
                cancellationToken
            );

            _logger.LogInformation("Order {OrderId} created successfully", result.OrderId);

            return CreatedAtAction(
                nameof(GetOrder),
                new { orderId = result.OrderId },
                result
            );
        } catch (InvalidOperationException ex) {
            _logger.LogWarning(ex, "Invalid order request");
            return BadRequest(new { error = ex.Message });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to create order");
            return StatusCode(500, new { error = "An unexpected error occurred" });
        }
    }

    [HttpGet("{orderId:guid}")]
    public ActionResult<OrderCreated> GetOrder(Guid orderId) {
        // Placeholder - in real app, query from read model via Lens
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
- Handle exceptions from receptors (validation errors, business rule violations)
- Return appropriate HTTP status codes (201 Created, 400 Bad Request, 500 Internal Server Error)

## Step 6: Run and Test

### Start the Application

```bash
dotnet run
```

**Expected output**:
```
info: Microsoft.Hosting.Lifetime[14]
      Now listening on: https://localhost:7001
info: Microsoft.Hosting.Lifetime[14]
      Now listening on: http://localhost:5001
```

### Test with curl

**Valid request**:
```bash
curl -X POST https://localhost:7001/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "550e8400-e29b-41d4-a716-446655440000",
    "productName": "Laptop",
    "quantity": 2,
    "unitPrice": 999.99
  }'
```

**Expected response** (201 Created):
```json
{
  "orderId": "018d8f8e-1234-7890-abcd-ef1234567890",
  "customerId": "550e8400-e29b-41d4-a716-446655440000",
  "productName": "Laptop",
  "quantity": 2,
  "unitPrice": 999.99,
  "total": 1999.98,
  "createdAt": "2024-12-12T10:30:00Z"
}
```

**Invalid request** (negative quantity):
```bash
curl -X POST https://localhost:7001/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "550e8400-e29b-41d4-a716-446655440000",
    "productName": "Laptop",
    "quantity": -5,
    "unitPrice": 999.99
  }'
```

**Expected response** (400 Bad Request):
```json
{
  "error": "Quantity must be greater than zero"
}
```

### Test with Swagger

1. Navigate to `https://localhost:7001/swagger`
2. Expand **POST /api/orders**
3. Click **Try it out**
4. Enter request body:
   ```json
   {
     "customerId": "550e8400-e29b-41d4-a716-446655440000",
     "productName": "Mechanical Keyboard",
     "quantity": 1,
     "unitPrice": 149.99
   }
   ```
5. Click **Execute**
6. Verify **201 Created** response

## What You Just Built

Congratulations! You've created a working Whizbang application with:

✅ **Type-safe messaging** - Compiler enforces CreateOrder → OrderCreated
✅ **Zero reflection** - All routing happens at compile time
✅ **Clean architecture** - Commands, events, and handlers are separated
✅ **Business logic isolation** - Validation and rules in receptor, not controller
✅ **Performance** - < 20ns dispatch with zero allocations

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
Return 201 Created with OrderCreated response
```

## Next Steps

### Add Source Generators (Auto-Discovery)

Currently, you're registering receptors manually:
```csharp
builder.Services.AddTransient<IReceptor<CreateOrder, OrderCreated>, CreateOrderReceptor>();
```

With **Whizbang.Generators**, receptors are discovered automatically:

1. Ensure `Whizbang.Generators` package is referenced
2. Remove manual receptor registrations
3. Add auto-discovery:
   ```csharp
   builder.Services.AddWhizbangCore();
   builder.Services.AddDiscoveredReceptors(); // Auto-registers all IReceptor implementations
   ```
4. Rebuild: `dotnet build`
5. Check `.whizbang-generated/ReceptorRegistrations.g.cs` for generated code

**Benefits**:
- No manual registration needed
- Compile-time verification
- AOT-compatible
- Zero reflection

### Add Perspectives (Read Models)

Perspectives listen to events and update read models:

**Perspectives/OrderSummaryPerspective.cs**:
```csharp
using Whizbang.Core;
using QuickStartApp.API.Messages;

public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly ILogger<OrderSummaryPerspective> _logger;
    // In real app: inject IDbConnectionFactory or DbContext

    public OrderSummaryPerspective(ILogger<OrderSummaryPerspective> logger) {
        _logger = logger;
    }

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        _logger.LogInformation(
            "Updating order summary for {OrderId} - Total: {Total:C}",
            @event.OrderId, @event.Total
        );

        // In real app: update denormalized read model in database
        // await _db.ExecuteAsync("INSERT INTO order_summaries (...) VALUES (...)", @event);
    }
}
```

Register perspective:
```csharp
builder.Services.AddTransient<IPerspectiveOf<OrderCreated>, OrderSummaryPerspective>();
// Or use AddDiscoveredPerspectives() with Whizbang.Generators
```

Publish events after receptor completes:
```csharp
var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command, ct);

// Publish event to all perspectives
await _dispatcher.PublishAsync(result, ct);
```

### Add Data Persistence

Install Dapper + PostgreSQL:
```bash
dotnet add package Whizbang.Data.Dapper.Postgres
```

Configure connection string in **appsettings.Development.json**:
```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=quickstart;Username=postgres;Password=your_password"
  }
}
```

Register database:
```csharp
builder.Services.AddWhizbangDapper(
    builder.Configuration.GetConnectionString("DefaultConnection")!
);
```

Use in receptor:
```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public CreateOrderReceptor(IDbConnectionFactory db) {
        _db = db;
    }

    public async ValueTask<OrderCreated> HandleAsync(CreateOrder message, CancellationToken ct = default) {
        // Save to database
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "INSERT INTO orders (order_id, customer_id, product_name, quantity, unit_price, total, created_at) VALUES (@OrderId, @CustomerId, @ProductName, @Quantity, @UnitPrice, @Total, @CreatedAt)",
            new {
                OrderId = orderId,
                message.CustomerId,
                message.ProductName,
                message.Quantity,
                message.UnitPrice,
                Total = total,
                CreatedAt = DateTimeOffset.UtcNow
            }
        );

        return new OrderCreated(/* ... */);
    }
}
```

### Add Tests

Install testing packages:
```bash
dotnet new tunit -n QuickStartApp.API.Tests
cd QuickStartApp.API.Tests
dotnet add package Whizbang.Testing
dotnet add package TUnit.Assertions
dotnet add reference ../QuickStartApp.API
```

Test your receptor:
```csharp
using TUnit.Assertions;
using QuickStartApp.API.Messages;
using QuickStartApp.API.Receptors;

public class CreateOrderReceptorTests {
    [Test]
    public async Task HandleAsync_ValidOrder_ReturnsOrderCreated() {
        // Arrange
        var logger = new NullLogger<CreateOrderReceptor>();
        var receptor = new CreateOrderReceptor(logger);

        var command = new CreateOrder(
            CustomerId: Guid.NewGuid(),
            ProductName: "Test Product",
            Quantity: 5,
            UnitPrice: 19.99m
        );

        // Act
        var result = await receptor.HandleAsync(command);

        // Assert
        await Assert.That(result.OrderId).IsNotEqualTo(Guid.Empty);
        await Assert.That(result.CustomerId).IsEqualTo(command.CustomerId);
        await Assert.That(result.ProductName).IsEqualTo("Test Product");
        await Assert.That(result.Quantity).IsEqualTo(5);
        await Assert.That(result.UnitPrice).IsEqualTo(19.99m);
        await Assert.That(result.Total).IsEqualTo(99.95m);
    }

    [Test]
    public async Task HandleAsync_InvalidQuantity_ThrowsException() {
        // Arrange
        var logger = new NullLogger<CreateOrderReceptor>();
        var receptor = new CreateOrderReceptor(logger);

        var command = new CreateOrder(
            CustomerId: Guid.NewGuid(),
            ProductName: "Test Product",
            Quantity: -1, // Invalid
            UnitPrice: 19.99m
        );

        // Act & Assert
        await Assert.That(async () => await receptor.HandleAsync(command))
            .ThrowsException<InvalidOperationException>()
            .WithMessage("Quantity must be greater than zero");
    }
}
```

Run tests:
```bash
dotnet test
```

### Explore the ECommerce Sample

The complete ECommerce sample demonstrates:
- **Backend for Frontend (BFF)** with SignalR real-time updates
- **Microservices** architecture (Order, Inventory, Payment, Shipping, Notification)
- **Event-driven workflows** with Outbox/Inbox patterns
- **.NET Aspire orchestration** for local development
- **Angular 20 UI** with NgRx state management
- **Integration testing** with TUnit

See [ECommerce Tutorial](../examples/ecommerce/overview.md) for complete walkthrough.

## Common Patterns

### Pattern 1: Command → Event
```csharp
CreateOrder (command) → CreateOrderReceptor → OrderCreated (event)
```
- Commands express **intent** (imperative: "create order")
- Events express **facts** (past tense: "order created")
- Receptors make **decisions** and return events

### Pattern 2: Event → Perspectives
```csharp
OrderCreated (event) → OrderSummaryPerspective → Update read model
                     → InventoryPerspective → Update stock levels
                     → AnalyticsPerspective → Update dashboards
```
- One event can trigger multiple perspectives
- Perspectives are **eventually consistent**
- Each perspective maintains its own optimized read model

### Pattern 3: Query via Lenses
```csharp
GET /api/orders/{id} → OrderLens → Query read model → Return DTO
```
- Lenses are **query-optimized** repositories
- Read from perspectives' denormalized tables
- Fast, simple SQL queries (no joins)

## Troubleshooting

### Issue: "No receptor registered for CreateOrder"

**Symptom**: Runtime exception when calling `LocalInvokeAsync`

**Solution**:
1. Verify receptor is registered in `Program.cs`:
   ```csharp
   builder.Services.AddTransient<IReceptor<CreateOrder, OrderCreated>, CreateOrderReceptor>();
   ```
2. Or use auto-discovery:
   ```csharp
   builder.Services.AddDiscoveredReceptors();
   ```
3. Rebuild: `dotnet clean && dotnet build`

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

**Symptom**: Source generators not creating files in `.whizbang-generated/`

**Solution**:
1. Ensure `Whizbang.Generators` package is referenced
2. Check MSBuild properties in `.csproj`:
   ```xml
   <PropertyGroup>
     <EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
     <CompilerGeneratedFilesOutputPath>$(MSBuildProjectDirectory)/.whizbang-generated</CompilerGeneratedFilesOutputPath>
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
🎯 **Type Safety** - compiler enforces message → response relationships
🎯 **Performance** - < 20ns in-process dispatch with zero allocations

## Further Reading

**Core Concepts**:
- [Dispatcher Deep Dive](../core-concepts/dispatcher.md) - Three dispatch patterns explained
- [Receptors Guide](../core-concepts/receptors.md) - Advanced receptor patterns
- [Perspectives Guide](../core-concepts/perspectives.md) - Building read models
- [Lenses Guide](../core-concepts/lenses.md) - Query optimization

**Messaging Patterns**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable cross-service messaging
- [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once message processing
- [Work Coordination](../messaging/work-coordinator.md) - Distributed work coordination

**Advanced Topics**:
- [Source Generators](../generators/receptor-discovery.md) - Auto-discovery internals
- [Performance Tuning](../performance/pooling-strategies.md) - Optimize for scale
- [Testing Strategies](../testing/receptor-testing.md) - Comprehensive testing guide

---

**Next**: [Project Structure Guide](project-structure.md) - Organize your Whizbang application

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
