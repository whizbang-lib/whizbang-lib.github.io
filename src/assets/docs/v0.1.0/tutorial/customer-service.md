---
title: "Customer Service (BFF)"
version: 0.1.0
category: Tutorial
order: 7
description: "Build the Customer Service BFF - perspectives, read models, CQRS query side, and GraphQL API"
tags: tutorial, customer-service, bff, perspectives, cqrs, read-models
---

# Customer Service (BFF)

Build the **Customer Service** - a Backend for Frontend (BFF) API that provides denormalized read models via **Perspectives**, demonstrating the query side of CQRS.

:::note
This is **Part 6** of the ECommerce Tutorial. Complete [Shipping Service](shipping-service.md) first.
:::

---

## What You'll Build

```
┌──────────────────────────────────────────────────────────────┐
│  Customer Service Architecture (BFF)                         │
│                                                               │
│  ┌─────────────┐                                             │
│  │Azure Service│  OrderCreated, PaymentProcessed, etc.       │
│  │     Bus     │──────────────────────────┐                  │
│  └─────────────┘                          │                  │
│                                            ▼                  │
│                          ┌────────────────────────────┐      │
│                          │  Perspectives (Event       │      │
│                          │  Handlers for Read Models) │      │
│                          │  - OrderSummaryPerspective │      │
│                          │  - CustomerActivityPersp.  │      │
│                          └──────────┬─────────────────┘      │
│                                     │                         │
│                                     ▼                         │
│                          ┌────────────────────────┐          │
│                          │  PostgreSQL Read Models│          │
│                          │  (Denormalized Views)  │          │
│                          └──────────┬─────────────┘          │
│                                     │                         │
│                                     ▼                         │
│  ┌──────────────┐        ┌────────────────────────┐          │
│  │  HTTP Client │───────▶│  HTTP API (REST)       │          │
│  │  (Frontend)  │        │  GET /customers/{id}   │          │
│  └──────────────┘        │  GET /orders/{id}      │          │
│                          └────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

**Features**:
- ✅ Perspectives (event-driven read models)
- ✅ Denormalized views (fast queries)
- ✅ CQRS query side
- ✅ BFF pattern (tailored to frontend needs)
- ✅ REST API with rich DTOs
- ✅ Event sourcing with time-travel queries

---

## Step 1: Database Schema (Read Models)

### Order Summary View

**ECommerce.CustomerService.API/Database/Migrations/001_CreateOrderSummaryTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS order_summary (
  order_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  total_amount NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL,  -- 'Pending', 'PaymentProcessed', 'Shipped', 'Delivered', 'Cancelled'
  item_count INTEGER NOT NULL,
  shipping_address JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL,
  payment_id TEXT,
  payment_status TEXT,
  payment_processed_at TIMESTAMP,
  shipment_id TEXT,
  tracking_number TEXT,
  estimated_delivery TIMESTAMP,
  actual_delivery TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_summary_customer_id ON order_summary(customer_id);
CREATE INDEX idx_order_summary_status ON order_summary(status);
CREATE INDEX idx_order_summary_created_at ON order_summary(created_at DESC);
```

### Customer Activity View

**ECommerce.CustomerService.API/Database/Migrations/002_CreateCustomerActivityTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS customer_activity (
  customer_id TEXT PRIMARY KEY,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC(10, 2) NOT NULL DEFAULT 0,
  last_order_id TEXT,
  last_order_at TIMESTAMP,
  first_order_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_activity_total_spent ON customer_activity(total_spent DESC);
CREATE INDEX idx_customer_activity_last_order_at ON customer_activity(last_order_at DESC);
```

---

## Step 2: Perspectives

### Order Summary Perspective

**ECommerce.CustomerService.API/Perspectives/OrderSummaryPerspective.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using Npgsql;
using Dapper;

namespace ECommerce.CustomerService.API.Perspectives;

public class OrderSummaryPerspective :
  IPerspectiveOf<OrderCreated>,
  IPerspectiveOf<PaymentProcessed>,
  IPerspectiveOf<ShipmentCreated> {

  private readonly NpgsqlConnection _db;
  private readonly ILogger<OrderSummaryPerspective> _logger;

  public OrderSummaryPerspective(
    NpgsqlConnection db,
    ILogger<OrderSummaryPerspective> logger
  ) {
    _db = db;
    _logger = logger;
  }

  // Handle OrderCreated event
  public async Task HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    await _db.ExecuteAsync(
      """
      INSERT INTO order_summary (
        order_id, customer_id, total_amount, status, item_count, shipping_address, created_at, updated_at
      )
      VALUES (@OrderId, @CustomerId, @TotalAmount, @Status, @ItemCount, @ShippingAddress::jsonb, @CreatedAt, NOW())
      ON CONFLICT (order_id) DO UPDATE SET
        updated_at = NOW()
      """,
      new {
        OrderId = @event.OrderId,
        CustomerId = @event.CustomerId,
        TotalAmount = @event.TotalAmount,
        Status = "Pending",
        ItemCount = @event.Items.Length,
        ShippingAddress = System.Text.Json.JsonSerializer.Serialize(@event.ShippingAddress),
        CreatedAt = @event.CreatedAt
      }
    );

    _logger.LogInformation(
      "Order summary created for order {OrderId}",
      @event.OrderId
    );
  }

  // Handle PaymentProcessed event
  public async Task HandleAsync(
    PaymentProcessed @event,
    CancellationToken ct = default
  ) {
    await _db.ExecuteAsync(
      """
      UPDATE order_summary
      SET
        status = 'PaymentProcessed',
        payment_id = @PaymentId,
        payment_status = @PaymentStatus,
        payment_processed_at = @ProcessedAt,
        updated_at = NOW()
      WHERE order_id = @OrderId
      """,
      new {
        OrderId = @event.OrderId,
        PaymentId = @event.PaymentId,
        PaymentStatus = @event.Status.ToString(),
        ProcessedAt = @event.ProcessedAt
      }
    );

    _logger.LogInformation(
      "Order summary updated with payment for order {OrderId}",
      @event.OrderId
    );
  }

  // Handle ShipmentCreated event
  public async Task HandleAsync(
    ShipmentCreated @event,
    CancellationToken ct = default
  ) {
    await _db.ExecuteAsync(
      """
      UPDATE order_summary
      SET
        status = 'Shipped',
        shipment_id = @ShipmentId,
        tracking_number = @TrackingNumber,
        estimated_delivery = @EstimatedDelivery,
        updated_at = NOW()
      WHERE order_id = @OrderId
      """,
      new {
        OrderId = @event.OrderId,
        ShipmentId = @event.ShipmentId,
        TrackingNumber = @event.TrackingNumber,
        EstimatedDelivery = @event.EstimatedDelivery
      }
    );

    _logger.LogInformation(
      "Order summary updated with shipment for order {OrderId}",
      @event.OrderId
    );
  }
}
```

**Key pattern**: **Single perspective handles multiple events** to build a denormalized view.

### Customer Activity Perspective

**ECommerce.CustomerService.API/Perspectives/CustomerActivityPerspective.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using Npgsql;
using Dapper;

namespace ECommerce.CustomerService.API.Perspectives;

public class CustomerActivityPerspective : IPerspectiveOf<OrderCreated> {
  private readonly NpgsqlConnection _db;
  private readonly ILogger<CustomerActivityPerspective> _logger;

  public CustomerActivityPerspective(
    NpgsqlConnection db,
    ILogger<CustomerActivityPerspective> logger
  ) {
    _db = db;
    _logger = logger;
  }

  public async Task HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    await _db.ExecuteAsync(
      """
      INSERT INTO customer_activity (
        customer_id, total_orders, total_spent, last_order_id, last_order_at, first_order_at, updated_at
      )
      VALUES (@CustomerId, 1, @TotalAmount, @OrderId, @CreatedAt, @CreatedAt, NOW())
      ON CONFLICT (customer_id) DO UPDATE SET
        total_orders = customer_activity.total_orders + 1,
        total_spent = customer_activity.total_spent + @TotalAmount,
        last_order_id = @OrderId,
        last_order_at = @CreatedAt,
        updated_at = NOW()
      """,
      new {
        CustomerId = @event.CustomerId,
        TotalAmount = @event.TotalAmount,
        OrderId = @event.OrderId,
        CreatedAt = @event.CreatedAt
      }
    );

    _logger.LogInformation(
      "Customer activity updated for customer {CustomerId}",
      @event.CustomerId
    );
  }
}
```

---

## Step 3: HTTP API

### DTOs

**ECommerce.CustomerService.API/Models/OrderSummaryDto.cs**:

```csharp
namespace ECommerce.CustomerService.API.Models;

public record OrderSummaryDto(
  string OrderId,
  string CustomerId,
  decimal TotalAmount,
  string Status,
  int ItemCount,
  ShippingAddressDto ShippingAddress,
  DateTime CreatedAt,
  PaymentInfoDto? PaymentInfo,
  ShipmentInfoDto? ShipmentInfo
);

public record ShippingAddressDto(
  string Street,
  string City,
  string State,
  string ZipCode,
  string Country
);

public record PaymentInfoDto(
  string PaymentId,
  string Status,
  DateTime ProcessedAt
);

public record ShipmentInfoDto(
  string ShipmentId,
  string TrackingNumber,
  DateTime EstimatedDelivery,
  DateTime? ActualDelivery
);
```

**ECommerce.CustomerService.API/Models/CustomerActivityDto.cs**:

```csharp
namespace ECommerce.CustomerService.API.Models;

public record CustomerActivityDto(
  string CustomerId,
  int TotalOrders,
  decimal TotalSpent,
  string? LastOrderId,
  DateTime? LastOrderAt,
  DateTime? FirstOrderAt
);
```

### Controllers

**ECommerce.CustomerService.API/Controllers/CustomersController.cs**:

```csharp
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Dapper;
using ECommerce.CustomerService.API.Models;

namespace ECommerce.CustomerService.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CustomersController : ControllerBase {
  private readonly NpgsqlConnection _db;
  private readonly ILogger<CustomersController> _logger;

  public CustomersController(
    NpgsqlConnection db,
    ILogger<CustomersController> logger
  ) {
    _db = db;
    _logger = logger;
  }

  [HttpGet("{customerId}")]
  [ProducesResponseType(typeof(CustomerActivityDto), StatusCodes.Status200OK)]
  [ProducesResponseType(StatusCodes.Status404NotFound)]
  public async Task<IActionResult> GetCustomer(string customerId) {
    var customer = await _db.QuerySingleOrDefaultAsync<CustomerActivityRow>(
      """
      SELECT customer_id, total_orders, total_spent, last_order_id, last_order_at, first_order_at
      FROM customer_activity
      WHERE customer_id = @CustomerId
      """,
      new { CustomerId = customerId }
    );

    if (customer == null) {
      return NotFound();
    }

    return Ok(new CustomerActivityDto(
      CustomerId: customer.CustomerId,
      TotalOrders: customer.TotalOrders,
      TotalSpent: customer.TotalSpent,
      LastOrderId: customer.LastOrderId,
      LastOrderAt: customer.LastOrderAt,
      FirstOrderAt: customer.FirstOrderAt
    ));
  }

  [HttpGet("{customerId}/orders")]
  [ProducesResponseType(typeof(OrderSummaryDto[]), StatusCodes.Status200OK)]
  public async Task<IActionResult> GetCustomerOrders(string customerId) {
    var orders = await _db.QueryAsync<OrderSummaryRow>(
      """
      SELECT
        order_id, customer_id, total_amount, status, item_count, shipping_address,
        created_at, payment_id, payment_status, payment_processed_at,
        shipment_id, tracking_number, estimated_delivery, actual_delivery
      FROM order_summary
      WHERE customer_id = @CustomerId
      ORDER BY created_at DESC
      """,
      new { CustomerId = customerId }
    );

    var dtos = orders.Select(o => new OrderSummaryDto(
      OrderId: o.OrderId,
      CustomerId: o.CustomerId,
      TotalAmount: o.TotalAmount,
      Status: o.Status,
      ItemCount: o.ItemCount,
      ShippingAddress: System.Text.Json.JsonSerializer.Deserialize<ShippingAddressDto>(o.ShippingAddress)!,
      CreatedAt: o.CreatedAt,
      PaymentInfo: o.PaymentId != null ? new PaymentInfoDto(
        PaymentId: o.PaymentId,
        Status: o.PaymentStatus!,
        ProcessedAt: o.PaymentProcessedAt!.Value
      ) : null,
      ShipmentInfo: o.ShipmentId != null ? new ShipmentInfoDto(
        ShipmentId: o.ShipmentId,
        TrackingNumber: o.TrackingNumber!,
        EstimatedDelivery: o.EstimatedDelivery!.Value,
        ActualDelivery: o.ActualDelivery
      ) : null
    )).ToArray();

    return Ok(dtos);
  }
}

public record CustomerActivityRow(
  string CustomerId,
  int TotalOrders,
  decimal TotalSpent,
  string? LastOrderId,
  DateTime? LastOrderAt,
  DateTime? FirstOrderAt
);

public record OrderSummaryRow(
  string OrderId,
  string CustomerId,
  decimal TotalAmount,
  string Status,
  int ItemCount,
  string ShippingAddress,  // JSONB
  DateTime CreatedAt,
  string? PaymentId,
  string? PaymentStatus,
  DateTime? PaymentProcessedAt,
  string? ShipmentId,
  string? TrackingNumber,
  DateTime? EstimatedDelivery,
  DateTime? ActualDelivery
);
```

**ECommerce.CustomerService.API/Controllers/OrdersController.cs**:

```csharp
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Dapper;
using ECommerce.CustomerService.API.Models;

namespace ECommerce.CustomerService.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase {
  private readonly NpgsqlConnection _db;
  private readonly ILogger<OrdersController> _logger;

  public OrdersController(
    NpgsqlConnection db,
    ILogger<OrdersController> logger
  ) {
    _db = db;
    _logger = logger;
  }

  [HttpGet("{orderId}")]
  [ProducesResponseType(typeof(OrderSummaryDto), StatusCodes.Status200OK)]
  [ProducesResponseType(StatusCodes.Status404NotFound)]
  public async Task<IActionResult> GetOrder(string orderId) {
    var order = await _db.QuerySingleOrDefaultAsync<OrderSummaryRow>(
      """
      SELECT
        order_id, customer_id, total_amount, status, item_count, shipping_address,
        created_at, payment_id, payment_status, payment_processed_at,
        shipment_id, tracking_number, estimated_delivery, actual_delivery
      FROM order_summary
      WHERE order_id = @OrderId
      """,
      new { OrderId = orderId }
    );

    if (order == null) {
      return NotFound();
    }

    return Ok(new OrderSummaryDto(
      OrderId: order.OrderId,
      CustomerId: order.CustomerId,
      TotalAmount: order.TotalAmount,
      Status: order.Status,
      ItemCount: order.ItemCount,
      ShippingAddress: System.Text.Json.JsonSerializer.Deserialize<ShippingAddressDto>(order.ShippingAddress)!,
      CreatedAt: order.CreatedAt,
      PaymentInfo: order.PaymentId != null ? new PaymentInfoDto(
        PaymentId: order.PaymentId,
        Status: order.PaymentStatus!,
        ProcessedAt: order.PaymentProcessedAt!.Value
      ) : null,
      ShipmentInfo: order.ShipmentId != null ? new ShipmentInfoDto(
        ShipmentId: order.ShipmentId,
        TrackingNumber: order.TrackingNumber!,
        EstimatedDelivery: order.EstimatedDelivery!.Value,
        ActualDelivery: order.ActualDelivery
      ) : null
    ));
  }
}
```

---

## Step 4: Service Configuration

**ECommerce.CustomerService.API/Program.cs**:

```csharp
using Whizbang.Core;
using Whizbang.Data.Postgres;
using Whizbang.Transports.AzureServiceBus;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// 1. Add Whizbang
builder.Services.AddWhizbang(options => {
  options.ServiceName = "CustomerService";
  options.EnableInbox = true;
});

// 2. Add PostgreSQL
builder.Services.AddScoped<NpgsqlConnection>(sp => {
  var connectionString = builder.Configuration.GetConnectionString("CustomerDb");
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

if (app.Environment.IsDevelopment()) {
  app.UseSwagger();
  app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

await app.MigrateDatabaseAsync();
app.Run();
```

---

## Step 5: Test BFF API

### 1. Create Order (Full Flow)

```bash
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

Wait for events to propagate through system (~10 seconds).

### 2. Query Customer Activity

```bash
curl http://localhost:5001/api/customers/cust-123
```

**Response**:

```json
{
  "customerId": "cust-123",
  "totalOrders": 1,
  "totalSpent": 39.98,
  "lastOrderId": "order-abc123",
  "lastOrderAt": "2024-12-12T10:30:00Z",
  "firstOrderAt": "2024-12-12T10:30:00Z"
}
```

### 3. Query Customer Orders

```bash
curl http://localhost:5001/api/customers/cust-123/orders
```

**Response**:

```json
[
  {
    "orderId": "order-abc123",
    "customerId": "cust-123",
    "totalAmount": 39.98,
    "status": "Shipped",
    "itemCount": 1,
    "shippingAddress": {
      "street": "123 Main St",
      "city": "Springfield",
      "state": "IL",
      "zipCode": "62701",
      "country": "USA"
    },
    "createdAt": "2024-12-12T10:30:00Z",
    "paymentInfo": {
      "paymentId": "pay-xyz789",
      "status": "Captured",
      "processedAt": "2024-12-12T10:31:00Z"
    },
    "shipmentInfo": {
      "shipmentId": "ship-def456",
      "trackingNumber": "123456789012",
      "estimatedDelivery": "2024-12-15T12:00:00Z",
      "actualDelivery": null
    }
  }
]
```

### 4. Query Single Order

```bash
curl http://localhost:5001/api/orders/order-abc123
```

**Response**: Same as above (single order).

---

## Key Concepts

### CQRS (Command Query Responsibility Segregation)

```
┌─────────────────────────────────────────────────────────┐
│  CQRS Pattern                                            │
│                                                          │
│  WRITE SIDE (Commands)                                  │
│  ┌──────────────────────────────────┐                   │
│  │  Order Service                   │                   │
│  │  - CreateOrder command           │                   │
│  │  - Publishes OrderCreated event  │                   │
│  └──────────────┬───────────────────┘                   │
│                 │                                        │
│                 ▼                                        │
│  ┌──────────────────────────────────┐                   │
│  │  Azure Service Bus (Events)      │                   │
│  └──────────────┬───────────────────┘                   │
│                 │                                        │
│                 ▼                                        │
│  READ SIDE (Queries)                                    │
│  ┌──────────────────────────────────┐                   │
│  │  Customer Service                │                   │
│  │  - OrderSummaryPerspective       │                   │
│  │  - Denormalized order_summary    │                   │
│  │  - Fast queries (no joins!)      │                   │
│  └──────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

**Benefits**:
- ✅ **Write optimization**: Order Service optimized for writes (ACID, validation)
- ✅ **Read optimization**: Customer Service optimized for reads (denormalized, indexed)
- ✅ **Independent scaling**: Scale read replicas independently
- ✅ **Eventual consistency**: Acceptable for most read queries

### Event-Driven Read Models

```csharp
// Single perspective updates from multiple events
public class OrderSummaryPerspective :
  IPerspectiveOf<OrderCreated>,       // Sets initial state
  IPerspectiveOf<PaymentProcessed>,   // Updates payment info
  IPerspectiveOf<ShipmentCreated> {   // Updates shipment info

  public async Task HandleAsync(OrderCreated @event) {
    // INSERT initial order summary
  }

  public async Task HandleAsync(PaymentProcessed @event) {
    // UPDATE with payment details
  }

  public async Task HandleAsync(ShipmentCreated @event) {
    // UPDATE with shipment details
  }
}
```

**Result**: Single `order_summary` row with data from 3 different events.

### BFF (Backend for Frontend)

```
┌─────────────────────────────────────────────────────────┐
│  BFF Pattern                                             │
│                                                          │
│  ┌──────────────┐                                       │
│  │  Web Client  │───────┐                               │
│  └──────────────┘       │                               │
│                         ▼                               │
│  ┌──────────────┐   ┌──────────────────┐               │
│  │Mobile Client │───▶│ Customer Service │               │
│  └──────────────┘   │      (BFF)       │               │
│                     │  - Tailored DTOs │               │
│                     │  - Aggregated data│               │
│                     │  - Client-specific│               │
│                     └──────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

**Key characteristics**:
- ✅ **Client-specific**: DTOs shaped for frontend needs
- ✅ **Aggregation**: Combines data from multiple events
- ✅ **Denormalization**: Pre-joins data for performance
- ✅ **Versioning**: API versions per client type

---

## Testing

### Unit Test - Perspective

```csharp
[Test]
public async Task OrderSummaryPerspective_OrderCreated_CreatesOrderSummaryAsync() {
  // Arrange
  var db = new MockNpgsqlConnection();
  var perspective = new OrderSummaryPerspective(db, mockLogger);
  var @event = new OrderCreated(...);

  // Act
  await perspective.HandleAsync(@event);

  // Assert
  var summary = db.GetOrderSummary(@event.OrderId);
  await Assert.That(summary).IsNotNull();
  await Assert.That(summary.Status).IsEqualTo("Pending");
}
```

---

## Next Steps

Continue to **[Analytics Service](analytics-service.md)** to:
- Build real-time analytics dashboards
- Aggregate events across all services
- Implement time-series perspectives
- Create daily/monthly reports

---

## Key Takeaways

✅ **CQRS** - Separate write (commands) and read (queries) models
✅ **Perspectives** - Event-driven read model updates
✅ **Denormalization** - Pre-join data for fast queries
✅ **BFF Pattern** - Tailor API to frontend needs
✅ **Eventual Consistency** - Acceptable for most read queries

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
