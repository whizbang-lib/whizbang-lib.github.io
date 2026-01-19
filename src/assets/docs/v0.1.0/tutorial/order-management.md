---
title: "Order Management Service"
version: 0.1.0
category: Tutorial
order: 2
description: "Build the Order Service - HTTP API, command handling, event publishing, and PostgreSQL persistence"
tags: tutorial, order-service, commands, events, http-api
---

# Order Management Service

Build the **Order Service** - an HTTP API that accepts order creation requests, validates them, persists to PostgreSQL, and publishes events to Azure Service Bus.

:::note
This is **Part 1** of the ECommerce Tutorial. Start with [Tutorial Overview](tutorial-overview.md) if you haven't already.
:::

---

## What You'll Build

```
┌─────────────────────────────────────────────────────────┐
│  Order Service Architecture                             │
│                                                          │
│  ┌──────────────┐                                       │
│  │    HTTP      │                                       │
│  │  Controller  │  POST /orders                         │
│  └──────┬───────┘                                       │
│         │                                                │
│         ▼                                                │
│  ┌──────────────┐  CreateOrder command                  │
│  │  Dispatcher  │─────────────────────────┐             │
│  └──────────────┘                         │             │
│                                            ▼             │
│                                 ┌─────────────────────┐ │
│                                 │ CreateOrderReceptor │ │
│                                 │  - Validate order   │ │
│                                 │  - Save to DB       │ │
│                                 │  - Publish event    │ │
│                                 └─────────┬───────────┘ │
│                                           │             │
│                              ┌────────────┼───────────┐ │
│                              │            │           │ │
│                              ▼            ▼           ▼ │
│                         ┌────────┐  ┌─────────┐  ┌─────┐
│                         │Postgres│  │ Outbox  │  │ ASB │
│                         │ Orders │  │ Table   │  │ Bus │
│                         └────────┘  └─────────┘  └─────┘
└─────────────────────────────────────────────────────────┘
```

**Features**:
- ✅ HTTP API endpoint for order creation
- ✅ Command handling with validation
- ✅ PostgreSQL persistence with outbox pattern
- ✅ Event publishing to Azure Service Bus
- ✅ Message context (correlation, causation, tracing)
- ✅ .NET Aspire orchestration

---

## Step 1: Define Messages

### Commands

**ECommerce.Contracts/Commands/CreateOrder.cs**:

```csharp
using Whizbang.Core;

namespace ECommerce.Contracts.Commands;

public record CreateOrder(
  string CustomerId,
  OrderItem[] Items,
  Address ShippingAddress
) : ICommand<OrderCreated>;

public record OrderItem(
  string ProductId,
  int Quantity,
  decimal UnitPrice
);

public record Address(
  string Street,
  string City,
  string State,
  string ZipCode,
  string Country
);
```

### Events

**ECommerce.Contracts/Events/OrderCreated.cs**:

```csharp
using Whizbang.Core;

namespace ECommerce.Contracts.Events;

public record OrderCreated(
  string OrderId,
  string CustomerId,
  OrderItem[] Items,
  Address ShippingAddress,
  decimal TotalAmount,
  DateTime CreatedAt
) : IEvent;

public record OrderItem(
  string ProductId,
  int Quantity,
  decimal UnitPrice,
  decimal LineTotal
);

public record Address(
  string Street,
  string City,
  string State,
  string ZipCode,
  string Country
);
```

**Why separate records?**
- Commands and events have different lifecycles
- Event includes calculated fields (`OrderId`, `TotalAmount`, `LineTotal`)
- Event is immutable history, command is intent

---

## Step 2: Database Schema

### Orders Table

**ECommerce.OrderService.API/Database/Migrations/001_CreateOrdersTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  total_amount NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL,
  shipping_address JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
```

### Order Items Table

**ECommerce.OrderService.API/Database/Migrations/002_CreateOrderItemsTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS order_items (
  order_item_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  line_total NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
```

### Outbox Table

**ECommerce.OrderService.API/Database/Migrations/003_CreateOutboxTable.sql**:

```sql
-- Whizbang outbox pattern for reliable event publishing
CREATE TABLE IF NOT EXISTS outbox (
  message_id UUID PRIMARY KEY,
  message_type TEXT NOT NULL,
  message_body JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMP,
  error_message TEXT
);

CREATE INDEX idx_outbox_unprocessed ON outbox(created_at)
  WHERE processed_at IS NULL;
```

---

## Step 3: Implement Receptor

**ECommerce.OrderService.API/Receptors/CreateOrderReceptor.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Commands;
using ECommerce.Contracts.Events;
using Npgsql;
using Dapper;

namespace ECommerce.OrderService.API.Receptors;

public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
  private readonly NpgsqlConnection _db;
  private readonly IMessageContext _context;
  private readonly ILogger<CreateOrderReceptor> _logger;

  public CreateOrderReceptor(
    NpgsqlConnection db,
    IMessageContext context,
    ILogger<CreateOrderReceptor> logger
  ) {
    _db = db;
    _context = context;
    _logger = logger;
  }

  public async Task<OrderCreated> HandleAsync(
    CreateOrder command,
    CancellationToken ct = default
  ) {
    // 1. Validate
    if (command.Items.Length == 0) {
      throw new ValidationException("Order must have at least one item");
    }

    // 2. Calculate totals
    var orderId = Guid.NewGuid().ToString("N");
    var totalAmount = command.Items.Sum(i => i.Quantity * i.UnitPrice);
    var createdAt = DateTime.UtcNow;

    // 3. Save order (with outbox pattern)
    await using var tx = await _db.BeginTransactionAsync(ct);

    try {
      // Insert order
      await _db.ExecuteAsync(
        """
        INSERT INTO orders (order_id, customer_id, total_amount, status, shipping_address, created_at, updated_at)
        VALUES (@OrderId, @CustomerId, @TotalAmount, @Status, @ShippingAddress::jsonb, @CreatedAt, @CreatedAt)
        """,
        new {
          OrderId = orderId,
          CustomerId = command.CustomerId,
          TotalAmount = totalAmount,
          Status = "Pending",
          ShippingAddress = System.Text.Json.JsonSerializer.Serialize(command.ShippingAddress),
          CreatedAt = createdAt
        },
        transaction: tx
      );

      // Insert order items
      foreach (var item in command.Items) {
        var lineTotal = item.Quantity * item.UnitPrice;
        await _db.ExecuteAsync(
          """
          INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price, line_total, created_at)
          VALUES (@OrderItemId, @OrderId, @ProductId, @Quantity, @UnitPrice, @LineTotal, @CreatedAt)
          """,
          new {
            OrderItemId = Guid.NewGuid().ToString("N"),
            OrderId = orderId,
            ProductId = item.ProductId,
            Quantity = item.Quantity,
            UnitPrice = item.UnitPrice,
            LineTotal = lineTotal,
            CreatedAt = createdAt
          },
          transaction: tx
        );
      }

      // 4. Create event
      var @event = new OrderCreated(
        OrderId: orderId,
        CustomerId: command.CustomerId,
        Items: command.Items.Select(i => new Contracts.Events.OrderItem(
          ProductId: i.ProductId,
          Quantity: i.Quantity,
          UnitPrice: i.UnitPrice,
          LineTotal: i.Quantity * i.UnitPrice
        )).ToArray(),
        ShippingAddress: new Contracts.Events.Address(
          Street: command.ShippingAddress.Street,
          City: command.ShippingAddress.City,
          State: command.ShippingAddress.State,
          ZipCode: command.ShippingAddress.ZipCode,
          Country: command.ShippingAddress.Country
        ),
        TotalAmount: totalAmount,
        CreatedAt: createdAt
      );

      // 5. Insert into outbox (same transaction)
      await _db.ExecuteAsync(
        """
        INSERT INTO outbox (message_id, message_type, message_body, created_at)
        VALUES (@MessageId, @MessageType, @MessageBody::jsonb, @CreatedAt)
        """,
        new {
          MessageId = _context.MessageId,
          MessageType = typeof(OrderCreated).FullName,
          MessageBody = System.Text.Json.JsonSerializer.Serialize(@event),
          CreatedAt = createdAt
        },
        transaction: tx
      );

      await tx.CommitAsync(ct);

      _logger.LogInformation(
        "Order {OrderId} created for customer {CustomerId} with {ItemCount} items, total ${TotalAmount}",
        orderId,
        command.CustomerId,
        command.Items.Length,
        totalAmount
      );

      return @event;
    } catch {
      await tx.RollbackAsync(ct);
      throw;
    }
  }
}
```

**Key patterns**:
- ✅ **Outbox Pattern**: Event inserted in same transaction as order
- ✅ **Validation**: Business rules enforced before persistence
- ✅ **Message Context**: `_context.MessageId` for correlation
- ✅ **Transactional**: All-or-nothing via PostgreSQL transaction

---

## Step 4: HTTP API

**ECommerce.OrderService.API/Controllers/OrdersController.cs**:

```csharp
using Microsoft.AspNetCore.Mvc;
using Whizbang.Core;
using ECommerce.Contracts.Commands;

namespace ECommerce.OrderService.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase {
  private readonly IDispatcher _dispatcher;
  private readonly ILogger<OrdersController> _logger;

  public OrdersController(
    IDispatcher dispatcher,
    ILogger<OrdersController> logger
  ) {
    _dispatcher = dispatcher;
    _logger = logger;
  }

  [HttpPost]
  [ProducesResponseType(StatusCodes.Status201Created)]
  [ProducesResponseType(StatusCodes.Status400BadRequest)]
  public async Task<IActionResult> CreateOrder(
    [FromBody] CreateOrder command,
    CancellationToken ct
  ) {
    try {
      var result = await _dispatcher.DispatchAsync(command, ct);

      return CreatedAtAction(
        nameof(GetOrder),
        new { orderId = result.OrderId },
        result
      );
    } catch (ValidationException ex) {
      return BadRequest(new { error = ex.Message });
    }
  }

  [HttpGet("{orderId}")]
  [ProducesResponseType(StatusCodes.Status200OK)]
  [ProducesResponseType(StatusCodes.Status404NotFound)]
  public async Task<IActionResult> GetOrder(string orderId) {
    // TODO: Implement query (Part 4 - Customer Service)
    return NotFound();
  }
}
```

---

## Step 5: Service Configuration

**ECommerce.OrderService.API/Program.cs**:

```csharp
using Whizbang.Core;
using Whizbang.Data.Postgres;
using Whizbang.Transports.AzureServiceBus;
using Whizbang.Hosting.Azure.ServiceBus;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// 1. Add Whizbang
builder.Services.AddWhizbang(options => {
  options.ServiceName = "OrderService";
  options.EnableOutbox = true;
  options.EnableInbox = true;
});

// 2. Add PostgreSQL
builder.Services.AddScoped<NpgsqlConnection>(sp => {
  var connectionString = builder.Configuration.GetConnectionString("OrdersDb");
  return new NpgsqlConnection(connectionString);
});

// 3. Add Azure Service Bus
builder.AddAzureServiceBus("messaging");

// 4. Add Aspire service defaults
builder.AddServiceDefaults();

// 5. Add controllers
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Configure HTTP pipeline
if (app.Environment.IsDevelopment()) {
  app.UseSwagger();
  app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

// Run database migrations
await app.MigrateDatabaseAsync();

app.Run();
```

**Database migration helper**:

**ECommerce.OrderService.API/Extensions/MigrationExtensions.cs**:

```csharp
using Npgsql;
using Dapper;

namespace ECommerce.OrderService.API.Extensions;

public static class MigrationExtensions {
  public static async Task MigrateDatabaseAsync(this WebApplication app) {
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<NpgsqlConnection>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    var migrationFiles = Directory.GetFiles(
      Path.Combine(AppContext.BaseDirectory, "Database/Migrations"),
      "*.sql"
    ).OrderBy(f => f);

    foreach (var file in migrationFiles) {
      var sql = await File.ReadAllTextAsync(file);
      await db.ExecuteAsync(sql);
      logger.LogInformation("Applied migration: {File}", Path.GetFileName(file));
    }
  }
}
```

---

## Step 6: Aspire Orchestration

**ECommerce.AppHost/Program.cs**:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

// 1. Add PostgreSQL
var postgres = builder.AddPostgres("postgres")
  .WithPgAdmin();

var ordersDb = postgres.AddDatabase("orders-db");

// 2. Add Azure Service Bus (emulator for local dev)
var serviceBus = builder.AddAzureServiceBus("messaging")
  .RunAsEmulator();

// 3. Add Order Service
var orderService = builder.AddProject<Projects.ECommerce_OrderService_API>("order-service")
  .WithReference(ordersDb)
  .WithReference(serviceBus);

builder.Build().Run();
```

**appsettings.json**:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Whizbang": "Debug"
    }
  },
  "AllowedHosts": "*",
  "ConnectionStrings": {
    "OrdersDb": "Host=localhost;Database=orders;Username=postgres;Password=postgres"
  },
  "Whizbang": {
    "ServiceName": "OrderService",
    "Outbox": {
      "Enabled": true,
      "BatchSize": 100,
      "PollingInterval": "00:00:05"
    },
    "Inbox": {
      "Enabled": true,
      "BatchSize": 100
    }
  }
}
```

---

## Step 7: Test the Flow

### 1. Start Aspire

```bash
cd ECommerce.AppHost
dotnet run
```

Open Aspire Dashboard: `http://localhost:15000`

### 2. Create Order

```bash
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust-123",
    "items": [
      {
        "productId": "prod-456",
        "quantity": 2,
        "unitPrice": 19.99
      },
      {
        "productId": "prod-789",
        "quantity": 1,
        "unitPrice": 49.99
      }
    ],
    "shippingAddress": {
      "street": "123 Main St",
      "city": "Springfield",
      "state": "IL",
      "zipCode": "62701",
      "country": "USA"
    }
  }'
```

**Expected response**:

```json
{
  "orderId": "a1b2c3d4e5f6",
  "customerId": "cust-123",
  "items": [
    {
      "productId": "prod-456",
      "quantity": 2,
      "unitPrice": 19.99,
      "lineTotal": 39.98
    },
    {
      "productId": "prod-789",
      "quantity": 1,
      "unitPrice": 49.99,
      "lineTotal": 49.99
    }
  ],
  "shippingAddress": {
    "street": "123 Main St",
    "city": "Springfield",
    "state": "IL",
    "zipCode": "62701",
    "country": "USA"
  },
  "totalAmount": 89.97,
  "createdAt": "2024-12-12T10:30:00Z"
}
```

### 3. Verify Database

```sql
-- Connect to PostgreSQL
psql -h localhost -U postgres -d orders

-- Check order
SELECT * FROM orders;

-- Check items
SELECT * FROM order_items;

-- Check outbox (event pending)
SELECT message_id, message_type, created_at, processed_at
FROM outbox;
```

### 4. Verify Event Publishing

Check Aspire Dashboard:
- **Order Service**: HTTP request logged
- **Service Bus**: OrderCreated event published
- **Outbox Worker**: Picked up event from outbox table

---

## Key Concepts

### Outbox Pattern

```
┌─────────────────────────────────────────────────────┐
│  Transactional Outbox Pattern                       │
│                                                      │
│  ┌──────────────────────────────────┐               │
│  │  PostgreSQL Transaction          │               │
│  │                                   │               │
│  │  1. INSERT INTO orders (...)     │               │
│  │  2. INSERT INTO order_items (...) │               │
│  │  3. INSERT INTO outbox (...)     │ ← Same TX!   │
│  │                                   │               │
│  │  COMMIT;                          │               │
│  └──────────────┬───────────────────┘               │
│                 │                                    │
│                 ▼                                    │
│  ┌──────────────────────────────────┐               │
│  │  Background Worker (Whizbang)    │               │
│  │                                   │               │
│  │  - SELECT * FROM outbox WHERE    │               │
│  │    processed_at IS NULL          │               │
│  │  - Publish to Azure Service Bus  │               │
│  │  - UPDATE outbox SET             │               │
│  │    processed_at = NOW()          │               │
│  └──────────────────────────────────┘               │
└─────────────────────────────────────────────────────┘
```

**Benefits**:
- ✅ **Atomic**: Order + event in single transaction
- ✅ **Reliable**: Event guaranteed published (eventually)
- ✅ **Consistent**: No partial state (order saved but event lost)

### Message Context

```csharp
public interface IMessageContext {
  Guid MessageId { get; }           // Unique ID for this message
  Guid? CorrelationId { get; }      // Business transaction ID
  Guid? CausationId { get; }        // ID of message that caused this one
  string? UserId { get; }           // User who initiated request
  IDictionary<string, string> Metadata { get; } // Custom metadata
}
```

**Flow example**:

```
HTTP Request
  CorrelationId: req-123
  MessageId: msg-001

CreateOrder Command
  CorrelationId: req-123 (same)
  CausationId: msg-001
  MessageId: msg-002

OrderCreated Event
  CorrelationId: req-123 (same)
  CausationId: msg-002
  MessageId: msg-003
```

This enables **distributed tracing** across services.

---

## Testing

### Unit Test

**ECommerce.OrderService.Tests/CreateOrderReceptorTests.cs**:

```csharp
using TUnit.Core;
using TUnit.Assertions;
using ECommerce.OrderService.API.Receptors;
using ECommerce.Contracts.Commands;

namespace ECommerce.OrderService.Tests;

public class CreateOrderReceptorTests {
  [Test]
  public async Task HandleAsync_ValidOrder_ReturnsOrderCreatedEvent() {
    // Arrange
    var db = new MockNpgsqlConnection();
    var context = new MockMessageContext();
    var logger = new MockLogger<CreateOrderReceptor>();
    var receptor = new CreateOrderReceptor(db, context, logger);

    var command = new CreateOrder(
      CustomerId: "cust-123",
      Items: [
        new OrderItem("prod-456", 2, 19.99m)
      ],
      ShippingAddress: new Address("123 Main", "Springfield", "IL", "62701", "USA")
    );

    // Act
    var result = await receptor.HandleAsync(command);

    // Assert
    await Assert.That(result.CustomerId).IsEqualTo("cust-123");
    await Assert.That(result.TotalAmount).IsEqualTo(39.98m);
    await Assert.That(result.Items).HasCount().EqualTo(1);
  }
}
```

### Integration Test

```csharp
[Test]
public async Task CreateOrder_EndToEnd_PublishesEvent() {
  // Arrange
  var factory = new WebApplicationFactory<Program>();
  var client = factory.CreateClient();

  var command = new {
    customerId = "cust-123",
    items = new[] {
      new { productId = "prod-456", quantity = 2, unitPrice = 19.99 }
    },
    shippingAddress = new {
      street = "123 Main",
      city = "Springfield",
      state = "IL",
      zipCode = "62701",
      country = "USA"
    }
  };

  // Act
  var response = await client.PostAsJsonAsync("/api/orders", command);

  // Assert
  await Assert.That(response.StatusCode).IsEqualTo(HttpStatusCode.Created);

  var result = await response.Content.ReadFromJsonAsync<OrderCreated>();
  await Assert.That(result!.TotalAmount).IsEqualTo(39.98m);
}
```

---

## Common Issues

### Issue 1: "Outbox table not found"

**Cause**: Migration not run
**Fix**:
```bash
# Ensure migrations executed on startup
dotnet run --project ECommerce.OrderService.API
```

### Issue 2: "Event not published"

**Cause**: Outbox worker not running
**Fix**: Check Aspire dashboard for worker logs. Verify Service Bus connection.

### Issue 3: "Transaction deadlock"

**Cause**: Long-running transaction
**Fix**: Keep receptor logic fast. Move heavy processing to event handlers.

---

## Next Steps

Continue to **[Inventory Service](inventory-service.md)** to:
- Subscribe to `OrderCreated` events
- Implement inventory reservation
- Publish `InventoryReserved` events
- Handle compensation (stock release)

---

## Key Takeaways

✅ **Outbox Pattern** - Atomic event publishing with database transactions
✅ **Command/Event Separation** - Clear intent (command) vs. fact (event)
✅ **Message Context** - Distributed tracing with correlation IDs
✅ **Validation** - Business rules enforced in receptors
✅ **.NET Aspire** - Local orchestration with PostgreSQL + Service Bus emulators

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
