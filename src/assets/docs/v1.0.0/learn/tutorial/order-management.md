---
title: Order Management Service
pageType: tutorial
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Tutorial
order: 2
description: >-
  Build the Order Service - HTTP API, command handling, event publishing, and
  PostgreSQL persistence
tags: 'tutorial, order-service, commands, events, http-api'
codeReferences:
  - samples/ECommerce/ECommerce.OrderService.API/Program.cs
  - >-
    samples/ECommerce/ECommerce.OrderService.API/Receptors/CreateOrderReceptor.cs
  - >-
    samples/ECommerce/ECommerce.OrderService.API/Endpoints/Orders/CreateOrderEndpoint.cs
  - samples/ECommerce/ECommerce.OrderService.API/OrderDbContext.cs
  - samples/ECommerce/ECommerce.Contracts/Commands/CreateOrderCommand.cs
  - samples/ECommerce/ECommerce.Contracts/Events/OrderCreatedEvent.cs
  - samples/ECommerce/ECommerce.Contracts/Ids.cs
testReferences:
  - >-
    samples/ECommerce/tests/ECommerce.OrderService.Tests/CreateOrderReceptorTests.cs
  - samples/ECommerce/ECommerce.IntegrationTests/OrderServiceIntegrationTests.cs
lastMaintainedCommit: '01f07906'
---

# Order Management Service

Build the **Order Service** - an HTTP API that accepts order creation requests, validates them, persists events via Whizbang's event store, and publishes events to the message bus.

:::note
This is **Part 1** of the ECommerce Tutorial. Start with [Tutorial Overview](tutorial-overview.md) if you haven't already.
:::

---

## What You'll Build

```mermaid{caption="Order Service architecture — the HTTP endpoint dispatches CreateOrderCommand to CreateOrderReceptor, which appends OrderCreatedEvent to the framework-managed event store and outbox for delivery to Azure Service Bus."}
flowchart TD
    subgraph OSA["Order Service Architecture"]
        Endpoint["HTTP Endpoint<br/>POST /api/orders"]
        Dispatcher["Dispatcher"]
        Receptor["CreateOrderReceptor<br/>- Validate order<br/>- Publish event"]
        EventStore["wh_event_store (Event Store)"]
        Outbox["wh_outbox (Outbox)"]
        ASB["Azure Service Bus"]

        Endpoint --> Dispatcher
        Dispatcher -->|"CreateOrderCommand"| Receptor
        Receptor -->|"OrderCreatedEvent"| EventStore
        Receptor --> Outbox
        Outbox --> ASB
    end

    class Endpoint layer-core
    class Dispatcher layer-command
    class Receptor layer-core
    class EventStore layer-event
    class Outbox,ASB layer-command
```

**Features**:
- ✅ HTTP API endpoint for order creation (FastEndpoints)
- ✅ Command handling with validation
- ✅ Framework-managed event store and outbox (no hand-written SQL)
- ✅ Event publishing to Azure Service Bus
- ✅ Strongly-typed IDs with `[WhizbangId]`
- ✅ .NET Aspire orchestration

---

## Step 1: Define Messages

### Strongly-Typed IDs

**ECommerce.Contracts/Ids.cs**:

```csharp{title="Strongly-Typed IDs" description="**ECommerce." category="Example" difficulty="BEGINNER" tags=["Learn", "Tutorial", "Ids"] unverified="tutorial worked-example — the sample IDs are exercised by the ECommerce sample suite (CreateOrderReceptorTests), which is outside the core unit-test coverage map"}
using Whizbang.Core;

namespace ECommerce.Contracts.Commands;

/// <summary>Strongly-typed ID for products using UUIDv7.</summary>
[WhizbangId]
public readonly partial struct ProductId;

/// <summary>Strongly-typed ID for orders using UUIDv7.</summary>
[WhizbangId]
public readonly partial struct OrderId;

/// <summary>Strongly-typed ID for customers using UUIDv7.</summary>
[WhizbangId]
public readonly partial struct CustomerId;
```

The `[WhizbangId]` source generator produces `OrderId.New()` (time-ordered UUIDv7), `OrderId.From(Guid)`, and a `Value` property — no reflection, AOT-safe.

### Commands

**ECommerce.Contracts/Commands/CreateOrderCommand.cs**:

```csharp{title="Commands" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Commands"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (CreateOrderReceptorTests), which is outside the core unit-test coverage map"}
using Whizbang.Core;

namespace ECommerce.Contracts.Commands;

/// <summary>
/// Command to create a new order
/// </summary>
public record CreateOrderCommand : ICommand {
  [StreamId]
  public required OrderId OrderId { get; init; }
  public required CustomerId CustomerId { get; init; }
  public required List<OrderLineItem> LineItems { get; init; }
  public decimal TotalAmount { get; init; }
}

public record OrderLineItem {
  public required ProductId ProductId { get; init; }
  public required string ProductName { get; init; }
  public int Quantity { get; init; }
  public decimal UnitPrice { get; init; }
}
```

### Events

**ECommerce.Contracts/Events/OrderCreatedEvent.cs**:

```csharp{title="Events" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Events"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (CreateOrderReceptorTests), which is outside the core unit-test coverage map"}
using ECommerce.Contracts.Commands;
using Whizbang.Core;

namespace ECommerce.Contracts.Events;

/// <summary>
/// Event published when an order is successfully created
/// </summary>
public record OrderCreatedEvent : IEvent {
  [StreamId]
  public required OrderId OrderId { get; init; }
  public required CustomerId CustomerId { get; init; }
  public required List<OrderLineItem> LineItems { get; init; }
  public decimal TotalAmount { get; init; }
  public DateTime CreatedAt { get; init; }
}
```

**Key points**:
- Commands implement `ICommand`, events implement `IEvent` (both are marker interfaces)
- `[StreamId]` marks the property that identifies the event stream (aggregate) — the source generator creates a zero-reflection stream ID extractor from it
- The command carries intent; the event includes derived facts (`CreatedAt`)

---

## Step 2: Persistence (Framework-Managed)

:::updated
Earlier drafts of this tutorial hand-wrote `orders`, `order_items`, and `outbox` tables with raw SQL migrations. Whizbang now provisions and manages its messaging tables (`wh_event_store`, `wh_outbox`, `wh_inbox`, and perspective tables) automatically — you only declare a `DbContext` with the `[WhizbangDbContext]` attribute.
:::

**ECommerce.OrderService.API/OrderDbContext.cs**:

```csharp{title="Step 2: Persistence" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Persistence", "DbContext"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (OrderServiceIntegrationTests), which is outside the core unit-test coverage map"}
using Microsoft.EntityFrameworkCore;
using Whizbang.Data.EFCore.Custom;

namespace ECommerce.OrderService.API;

/// <summary>
/// DbContext for OrderService.API - provides Inbox, Outbox, and EventStore via Whizbang EF Core driver.
/// [WhizbangDbContext] attribute triggers source generation for:
/// - EnsureWhizbangDatabaseInitializedAsync() extension method
/// - DbSet properties for Inbox, Outbox, EventStore
/// - Model configuration in OnModelCreating
/// </summary>
[WhizbangDbContext]
public partial class OrderDbContext(DbContextOptions<OrderDbContext> options) : DbContext(options) {
  // DbSet properties and OnModelCreating are auto-generated in partial class
}
```

At startup, the generated `EnsureWhizbangDatabaseInitializedAsync()` extension creates all Whizbang tables and PostgreSQL functions — no migration SQL to maintain.

---

## Step 3: Implement Receptor

**ECommerce.OrderService.API/Receptors/CreateOrderReceptor.cs**:

```csharp{title="Step 3: Implement Receptor" description="**ECommerce." category="Example" difficulty="ADVANCED" tags=["Learn", "Tutorial", "Step", "Implement"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (CreateOrderReceptorTests), which is outside the core unit-test coverage map"}
using ECommerce.Contracts.Commands;
using ECommerce.Contracts.Events;
using Whizbang.Core;

namespace ECommerce.OrderService.API.Receptors;

/// <summary>
/// Handles CreateOrderCommand and publishes OrderCreatedEvent
/// </summary>
public class CreateOrderReceptor(IDispatcher dispatcher, ILogger<CreateOrderReceptor> logger) : IReceptor<CreateOrderCommand, OrderCreatedEvent> {

  public async ValueTask<OrderCreatedEvent> HandleAsync(
    CreateOrderCommand message,
    CancellationToken cancellationToken = default) {

    logger.LogInformation(
      "Processing order {OrderId} for customer {CustomerId} with {ItemCount} items",
      message.OrderId,
      message.CustomerId,
      message.LineItems.Count);

    // Validate order (business logic would go here)
    if (message.TotalAmount <= 0) {
      throw new InvalidOperationException("Order total must be positive");
    }

    if (message.LineItems.Count == 0) {
      throw new InvalidOperationException("Order must contain at least one item");
    }

    // Create the event
    var orderCreated = new OrderCreatedEvent {
      OrderId = message.OrderId,
      CustomerId = message.CustomerId,
      LineItems = message.LineItems,
      TotalAmount = message.TotalAmount,
      CreatedAt = DateTime.UtcNow
    };

    // Publish the event for cross-service delivery
    // This will be sent to Azure Service Bus and consumed by other services
    await dispatcher.PublishAsync(orderCreated);

    logger.LogInformation("Order {OrderId} created and event published", message.OrderId);

    return orderCreated;
  }
}
```

**Key patterns**:
- ✅ **`IReceptor<TMessage, TResponse>`**: `HandleAsync` returns `ValueTask<TResponse>` and takes a `CancellationToken`
- ✅ **Validation**: Business rules enforced before publishing
- ✅ **Outbox Pattern**: `PublishAsync` writes to the framework-managed outbox — event store append, outbox insert, and cross-service delivery are handled by Whizbang
- ✅ **Return value**: The returned event is available to callers using `LocalInvokeAsync`

---

## Step 4: HTTP API

The sample uses **FastEndpoints** for the REST API.

**ECommerce.OrderService.API/Endpoints/Orders/CreateOrderEndpoint.cs**:

```csharp{title="Step 4: HTTP API" description="**ECommerce." category="Example" difficulty="ADVANCED" tags=["Learn", "Tutorial", "Step", "HTTP"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (OrderServiceIntegrationTests), which is outside the core unit-test coverage map"}
using ECommerce.Contracts.Commands;
using ECommerce.Contracts.Events;
using ECommerce.OrderService.API.Endpoints.Models;
using FastEndpoints;
using Whizbang.Core;

namespace ECommerce.OrderService.API.Endpoints.Orders;

/// <summary>
/// FastEndpoints endpoint for creating orders
/// </summary>
public class CreateOrderEndpoint(IDispatcher dispatcher) : Endpoint<CreateOrderRequest, CreateOrderResponse> {

  public override void Configure() {
    Post("/orders");
    AllowAnonymous();
  }

  public override async Task HandleAsync(CreateOrderRequest req, CancellationToken ct) {
    var orderId = OrderId.New();
    var items = req.LineItems.Select(li => new OrderLineItem {
      ProductId = ProductId.From(Guid.Parse(li.ProductId)),
      ProductName = li.ProductName,
      Quantity = li.Quantity,
      UnitPrice = li.UnitPrice
    }).ToList();

    var totalAmount = items.Sum(i => i.Quantity * i.UnitPrice);

    var command = new CreateOrderCommand {
      OrderId = orderId,
      CustomerId = CustomerId.From(Guid.Parse(req.CustomerId)),
      LineItems = items,
      TotalAmount = totalAmount
    };

    // Dispatch the command locally and wait for the result
    var orderCreated = await dispatcher.LocalInvokeAsync<OrderCreatedEvent>(command);

    Response = new CreateOrderResponse {
      OrderId = orderCreated.OrderId.Value.ToString(),
      Status = "Created",
      TotalAmount = orderCreated.TotalAmount
    };
  }
}
```

**Request/response models** (**ECommerce.OrderService.API/Endpoints/Models/**):

```csharp{title="Step 4: HTTP API - Models" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Step", "HTTP"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (OrderServiceIntegrationTests), which is outside the core unit-test coverage map"}
namespace ECommerce.OrderService.API.Endpoints.Models;

public record CreateOrderRequest {
  public required string CustomerId { get; init; }
  public required List<OrderLineItemDto> LineItems { get; init; }
}

public record OrderLineItemDto {
  public required string ProductId { get; init; }
  public required string ProductName { get; init; }
  public int Quantity { get; init; }
  public decimal UnitPrice { get; init; }
}

public record CreateOrderResponse {
  public required string OrderId { get; init; }
  public required string Status { get; init; }
  public decimal TotalAmount { get; init; }
}
```

**Dispatcher patterns** — pick the one that fits:
- `dispatcher.LocalInvokeAsync<OrderCreatedEvent>(command)` — in-process RPC, returns the typed business result (used here)
- `dispatcher.SendAsync(command)` — returns `Task<IDeliveryReceipt>`; the command may be routed over the wire
- `dispatcher.PublishAsync(eventData)` — broadcast an event to all interested handlers

---

## Step 5: Service Configuration

**ECommerce.OrderService.API/Program.cs** (condensed from the sample):

```csharp{title="Step 5: Service Configuration" description="**ECommerce." category="Example" difficulty="ADVANCED" tags=["Learn", "Tutorial", "Step", "Service"] unverified="host/DI wiring — not exercised by a test"}
using ECommerce.Contracts.Generated;
using ECommerce.OrderService.API;
using ECommerce.OrderService.API.Generated;
using FastEndpoints;
using FastEndpoints.Swagger;
using Microsoft.EntityFrameworkCore;
using Whizbang.Core;
using Whizbang.Core.Generated;
using Whizbang.Core.Messaging;
using Whizbang.Core.Observability;
using Whizbang.Core.Workers;
using Whizbang.Data.EFCore.Postgres;
using Whizbang.Transports.AzureServiceBus;

var builder = WebApplication.CreateBuilder(args);

// Aspire service defaults (telemetry, health checks, service discovery)
builder.AddServiceDefaults();

// FastEndpoints REST API
builder.Services.AddFastEndpoints();
builder.Services.SwaggerDocument();

// Connection strings resolved by Aspire
var postgresConnection = builder.Configuration.GetConnectionString("ordersdb")
    ?? throw new InvalidOperationException("PostgreSQL connection string 'ordersdb' not found");
var serviceBusConnection = builder.Configuration.GetConnectionString("servicebus")
    ?? throw new InvalidOperationException("Azure Service Bus connection string 'servicebus' not found");

// Register Azure Service Bus transport
builder.Services.AddAzureServiceBusTransport(serviceBusConnection);
builder.Services.AddAzureServiceBusHealthChecks();

// Observability + worker infrastructure
builder.Services.AddSingleton<ITraceStore, InMemoryTraceStore>();
builder.Services.AddSingleton<IServiceInstanceProvider, ServiceInstanceProvider>();
builder.Services.AddSingleton<OrderedStreamProcessor>();

// EF Core DbContext for Inbox/Outbox/EventStore
builder.Services.AddDbContext<OrderDbContext>(options =>
  options.UseNpgsql(postgresConnection));

// Unified Whizbang API with EF Core Postgres driver
// Automatically registers IInbox, IOutbox, IEventStore
_ = builder.Services
  .AddWhizbang()
  .WithEFCore<OrderDbContext>()
  .WithDriver.Postgres;

// Whizbang generated services (receptor discovery + dispatcher)
builder.Services.AddReceptors();
builder.Services.AddWhizbangDispatcher();

var app = builder.Build();

// Initialize Whizbang tables (Inbox/Outbox/EventStore + PostgreSQL functions)
using (var scope = app.Services.CreateScope()) {
  var dbContext = scope.ServiceProvider.GetRequiredService<OrderDbContext>();
  var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
  await dbContext.EnsureWhizbangDatabaseInitializedAsync(logger);
}

app.UseFastEndpoints(config => {
  config.Endpoints.RoutePrefix = "api";
});

app.MapDefaultEndpoints();

app.Run();
```

:::updated
There is no `AddWhizbang(options => ...)` overload with `ServiceName`/`EnableOutbox` flags. Configuration is expressed through the fluent chain: `AddWhizbang().WithEFCore<TDbContext>().WithDriver.Postgres` (plus `.WithRouting(...)` and `.AddTransportConsumer()` on services that consume from the bus — see the Inventory tutorial).
:::

---

## Step 6: Aspire Orchestration

**ECommerce.AppHost/Program.cs** (condensed from the sample):

```csharp{title="Step 6: Aspire Orchestration" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Step", "Aspire"] unverified="host/DI wiring — not exercised by a test"}
var builder = DistributedApplication.CreateBuilder(args);

// PostgreSQL with pgAdmin (persistent across restarts)
var postgres = builder.AddPostgres("postgres")
    .WithDataVolume("postgres-data")
    .WithLifetime(ContainerLifetime.Persistent)
    .WithPgAdmin();

var ordersDb = postgres.AddDatabase("ordersdb");

// Azure Service Bus emulator for local development
var messagingInfra = builder.AddAzureServiceBus("servicebus")
    .RunAsEmulator(configureContainer => configureContainer
        .WithLifetime(ContainerLifetime.Persistent));

// "orders" topic with per-service subscriptions
var ordersTopic = messagingInfra.AddServiceBusTopic("orders");
ordersTopic.AddServiceBusSubscription("sub-inventory-orders");
ordersTopic.AddServiceBusSubscription("sub-payment-orders");

// Order Service
var orderService = builder.AddProject("orderservice", "../ECommerce.OrderService.API/ECommerce.OrderService.API.csproj")
    .WithReference(ordersDb)
    .WithReference(messagingInfra)
    .WaitFor(ordersDb)
    .WaitFor(messagingInfra)
    .WithExternalHttpEndpoints();

builder.Build().Run();
```

---

## Step 7: Test the Flow

### 1. Start Aspire

```bash{title="Start Aspire" description="Start Aspire" category="Example" difficulty="BEGINNER" tags=["Learn", "Tutorial", "Start", "Aspire"]}
cd ECommerce.AppHost
dotnet run
```

Open the Aspire Dashboard from the URL printed in the console.

### 2. Create Order

```bash{title="Create Order" description="Create Order" category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Create", "Order"]}
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "0195b3f0-1234-7abc-8def-0123456789ab",
    "lineItems": [
      {
        "productId": "0195b3f0-5678-7abc-8def-0123456789ab",
        "productName": "Widget",
        "quantity": 2,
        "unitPrice": 19.99
      }
    ]
  }'
```

**Expected response**:

```json{title="Create Order (2)" description="Expected response:" category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Create", "Order"]}
{
  "orderId": "0195b3f0-9abc-7abc-8def-0123456789ab",
  "status": "Created",
  "totalAmount": 39.98
}
```

### 3. Verify Database

```sql{title="Verify Database" description="Verify Database" category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Verify", "Database"]}
-- Connect to PostgreSQL (ordersdb)

-- Check the event store (OrderCreatedEvent appended)
SELECT stream_id, event_type, created_at FROM wh_event_store ORDER BY created_at DESC;

-- Check the outbox (pending rows are removed once delivered)
SELECT message_id, status, created_at FROM wh_outbox;
```

### 4. Verify Event Publishing

Check Aspire Dashboard:
- **Order Service**: HTTP request logged
- **Service Bus**: OrderCreatedEvent published to the `orders` topic
- **Outbox Worker**: Picked up event from `wh_outbox`

---

## Key Concepts

### Outbox Pattern

```mermaid{caption="Transactional outbox pattern — the event-store append and outbox insert commit in a single PostgreSQL transaction; the Whizbang outbox worker then claims pending rows and publishes them to Azure Service Bus."}
flowchart TD
    subgraph TOP["Transactional Outbox Pattern (Whizbang-managed)"]
        TX["PostgreSQL Transaction<br/>1. Append event to wh_event_store<br/>2. INSERT INTO wh_outbox ← Same TX!<br/>COMMIT;"]
        Worker["Outbox Worker (Whizbang)<br/>- Claims pending wh_outbox rows (lease-based)<br/>- Publishes to Azure Service Bus<br/>- Completes/removes the row"]

        TX --> Worker
    end

    class TX layer-event
    class Worker layer-command
```

**Benefits**:
- ✅ **Atomic**: Event store append + outbox insert in a single transaction
- ✅ **Reliable**: Event guaranteed published (eventually)
- ✅ **Zero boilerplate**: You call `PublishAsync` — Whizbang does the rest

### Message Context

Every dispatched message carries an `IMessageContext` for correlation and tracing:

```csharp{title="Message Context" description="Message Context" category="Example" difficulty="BEGINNER" tags=["Learn", "Tutorial", "Message", "Context"] tests=["MessageContextTests.Properties_CanBeSetViaInitializer_WithInitSyntaxAsync", "MessageContextTests.DefaultConstructor_InitializesRequiredProperties_AutomaticallyAsync", "MessageContextTests.Metadata_IsEmptyByDefaultAsync"]}
public interface IMessageContext {
  MessageId MessageId { get; }         // Unique ID for this message
  CorrelationId CorrelationId { get; } // Business transaction ID
  MessageId CausationId { get; }       // ID of the message that caused this one
  DateTimeOffset Timestamp { get; }    // When the message was created
  string? UserId { get; }              // User who initiated the request
  string? TenantId { get; }            // Tenant context (multi-tenant scenarios)
  IReadOnlyDictionary<string, object> Metadata { get; } // Custom metadata
  // ... plus security scope and caller info
}
```

**Flow example**:

```
HTTP Request
  CorrelationId: req-123
  MessageId: msg-001

CreateOrderCommand
  CorrelationId: req-123 (same)
  CausationId: msg-001
  MessageId: msg-002

OrderCreatedEvent
  CorrelationId: req-123 (same)
  CausationId: msg-002
  MessageId: msg-003
```

This enables **distributed tracing** across services.

---

## Testing

### Unit Test

**samples/ECommerce/tests/ECommerce.OrderService.Tests/CreateOrderReceptorTests.cs** (condensed):

```csharp{title="Unit Test" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Unit", "Test"] unverified="tutorial worked-example — this is the ECommerce sample unit test (CreateOrderReceptorTests) itself, which is outside the core unit-test coverage map"}
using ECommerce.Contracts.Commands;
using ECommerce.Contracts.Events;
using ECommerce.OrderService.API.Receptors;
using Microsoft.Extensions.Logging.Abstractions;

namespace ECommerce.OrderService.Tests;

public class CreateOrderReceptorTests {
  [Test]
  public async Task CreateOrderReceptor_ValidOrder_PublishesEventAsync() {
    // Arrange - TestDispatcher records published messages (see sample for full impl)
    var dispatcher = new TestDispatcher();
    var logger = NullLogger<CreateOrderReceptor>.Instance;
    var receptor = new CreateOrderReceptor(dispatcher, logger);

    var command = new CreateOrderCommand {
      OrderId = OrderId.New(),
      CustomerId = CustomerId.New(),
      LineItems = [
        new OrderLineItem {
          ProductId = ProductId.New(),
          ProductName = "Widget",
          Quantity = 2,
          UnitPrice = 19.99m
        }
      ],
      TotalAmount = 39.98m
    };

    // Act
    var result = await receptor.HandleAsync(command);

    // Assert
    await Assert.That(result.OrderId).IsEqualTo(command.OrderId);
    await Assert.That(result.TotalAmount).IsEqualTo(39.98m);
    await Assert.That(dispatcher.PublishCount).IsEqualTo(1);
    await Assert.That(dispatcher.PublishedMessages[0]).IsTypeOf<OrderCreatedEvent>();
  }

  [Test]
  public async Task CreateOrderReceptor_EmptyLineItems_ThrowsInvalidOperationExceptionAsync() {
    // Arrange
    var dispatcher = new TestDispatcher();
    var receptor = new CreateOrderReceptor(dispatcher, NullLogger<CreateOrderReceptor>.Instance);

    var command = new CreateOrderCommand {
      OrderId = OrderId.New(),
      CustomerId = CustomerId.New(),
      LineItems = [],  // Empty list
      TotalAmount = 39.98m
    };

    // Act & Assert
    await Assert.That(async () => await receptor.HandleAsync(command))
      .Throws<InvalidOperationException>()
      .WithMessage("Order must contain at least one item");
  }
}
```

Receptors take `IDispatcher` + `ILogger` — no database mocking needed. Use a recording `TestDispatcher` (see the sample test file) to assert on published events.

---

## Common Issues

### Issue 1: "Whizbang tables not found"

**Cause**: `EnsureWhizbangDatabaseInitializedAsync()` not called on startup
**Fix**: Add the initialization scope shown in Step 5 before `app.Run()`.

### Issue 2: "Event not published"

**Cause**: Outbox worker not running or transport not registered
**Fix**: Check Aspire dashboard for worker logs. Verify `AddAzureServiceBusTransport(...)` is registered and the Service Bus emulator is healthy.

### Issue 3: "ReceptorNotFoundException"

**Cause**: `AddReceptors()` (generated registration) not called, or the receptor assembly isn't referenced
**Fix**: Call `builder.Services.AddReceptors()` and `builder.Services.AddWhizbangDispatcher()`.

---

## Next Steps

Continue to **[Inventory Service](inventory-service.md)** to:
- Subscribe to order events
- Implement inventory reservation
- Publish `InventoryReservedEvent`
- Maintain perspectives (read models)

---

## Key Takeaways

✅ **Outbox Pattern** - Atomic event publishing, managed by the framework
✅ **Command/Event Separation** - Clear intent (command) vs. fact (event)
✅ **Strongly-Typed IDs** - `[WhizbangId]` structs with UUIDv7 time-ordering
✅ **Message Context** - Distributed tracing with correlation IDs
✅ **Validation** - Business rules enforced in receptors
✅ **.NET Aspire** - Local orchestration with PostgreSQL + Service Bus emulators

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
