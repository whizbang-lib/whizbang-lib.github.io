---
title: Inventory Service
version: 1.0.0
category: Tutorial
order: 3
description: >-
  Build the Inventory Worker - event subscription, stock reservations,
  compensation, and perspectives
tags: 'tutorial, inventory-service, event-driven, perspectives, compensation'
---

# Inventory Service

Build the **Inventory Worker** - a background service that subscribes to `OrderCreated` events, reserves inventory, publishes `InventoryReserved` events, and maintains read models via perspectives.

:::note
This is **Part 2** of the ECommerce Tutorial. Complete [Order Management](order-management.md) first.
:::

---

## What You'll Build

```
┌─────────────────────────────────────────────────────────────┐
│  Inventory Service Architecture                             │
│                                                              │
│  ┌─────────────┐                                            │
│  │Azure Service│  OrderCreated event                        │
│  │     Bus     │──────────────────────┐                     │
│  └─────────────┘                      │                     │
│                                        ▼                     │
│                          ┌────────────────────────┐         │
│                          │  Inbox Pattern         │         │
│                          │  (Exactly-Once)        │         │
│                          └──────────┬─────────────┘         │
│                                     │                        │
│                                     ▼                        │
│                          ┌────────────────────────┐         │
│                          │ ReserveInventoryReceptor│        │
│                          │  - Check stock         │         │
│                          │  - Reserve units       │         │
│                          │  - Publish event       │         │
│                          └──────────┬─────────────┘         │
│                                     │                        │
│                      ┌──────────────┼──────────────┐        │
│                      │              │              │        │
│                      ▼              ▼              ▼        │
│                 ┌─────────┐   ┌─────────┐   ┌──────────┐   │
│                 │Postgres │   │ Outbox  │   │Perspective│  │
│                 │Inventory│   │ Table   │   │  (Read    │  │
│                 │  Table  │   │         │   │  Model)   │  │
│                 └─────────┘   └─────────┘   └──────────┘   │
│                                     │                        │
│                                     ▼                        │
│                          ┌────────────────────────┐         │
│                          │ Azure Service Bus      │         │
│                          │ InventoryReserved      │         │
│                          └────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

**Features**:
- ✅ Event subscription (OrderCreated)
- ✅ Inbox pattern (exactly-once processing)
- ✅ Inventory reservation logic
- ✅ Compensation (stock release on failure)
- ✅ Perspective read model (InventorySummary)
- ✅ Work coordination via PostgreSQL

---

## Step 1: Define Events

### InventoryReserved Event

**ECommerce.Contracts/Events/InventoryReserved.cs**:

```csharp
using Whizbang.Core;

namespace ECommerce.Contracts.Events;

public record InventoryReserved(
  string OrderId,
  string ProductId,
  int QuantityReserved,
  int RemainingStock,
  DateTime ReservedAt
) : IEvent;
```

### InventoryInsufficient Event (Compensation)

**ECommerce.Contracts/Events/InventoryInsufficient.cs**:

```csharp
using Whizbang.Core;

namespace ECommerce.Contracts.Events;

public record InventoryInsufficient(
  string OrderId,
  string ProductId,
  int RequestedQuantity,
  int AvailableStock,
  DateTime CheckedAt
) : IEvent;
```

**Why two events?**
- Success path: `InventoryReserved` triggers payment processing
- Failure path: `InventoryInsufficient` triggers order cancellation (compensation)

---

## Step 2: Database Schema

### Inventory Table

**ECommerce.InventoryWorker/Database/Migrations/001_CreateInventoryTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS inventory (
  product_id TEXT PRIMARY KEY,
  available_stock INTEGER NOT NULL CHECK (available_stock >= 0),
  reserved_stock INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  total_stock INTEGER GENERATED ALWAYS AS (available_stock + reserved_stock) STORED,
  last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1  -- Optimistic concurrency
);

CREATE INDEX idx_inventory_product_id ON inventory(product_id);

-- Seed data for demo
INSERT INTO inventory (product_id, available_stock, reserved_stock)
VALUES
  ('prod-456', 100, 0),
  ('prod-789', 50, 0)
ON CONFLICT (product_id) DO NOTHING;
```

### Reservations Table

**ECommerce.InventoryWorker/Database/Migrations/002_CreateReservationsTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS inventory_reservations (
  reservation_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES inventory(product_id),
  quantity_reserved INTEGER NOT NULL,
  status TEXT NOT NULL,  -- 'Reserved', 'Released', 'Committed'
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL  -- Auto-release after N minutes
);

CREATE INDEX idx_reservations_order_id ON inventory_reservations(order_id);
CREATE INDEX idx_reservations_product_id ON inventory_reservations(product_id);
CREATE INDEX idx_reservations_expires_at ON inventory_reservations(expires_at)
  WHERE status = 'Reserved';
```

### Inbox Table

**ECommerce.InventoryWorker/Database/Migrations/003_CreateInboxTable.sql**:

```sql
-- Whizbang inbox pattern for exactly-once processing
CREATE TABLE IF NOT EXISTS inbox (
  message_id UUID PRIMARY KEY,
  message_type TEXT NOT NULL,
  message_body JSONB NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMP,
  error_message TEXT
);

CREATE INDEX idx_inbox_unprocessed ON inbox(received_at)
  WHERE processed_at IS NULL;
```

---

## Step 3: Implement Receptor

**ECommerce.InventoryWorker/Receptors/ReserveInventoryReceptor.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using Npgsql;
using Dapper;

namespace ECommerce.InventoryWorker.Receptors;

public class ReserveInventoryReceptor : IReceptor<OrderCreated, InventoryReserved> {
  private readonly NpgsqlConnection _db;
  private readonly IMessageContext _context;
  private readonly ILogger<ReserveInventoryReceptor> _logger;

  public ReserveInventoryReceptor(
    NpgsqlConnection db,
    IMessageContext context,
    ILogger<ReserveInventoryReceptor> logger
  ) {
    _db = db;
    _context = context;
    _logger = logger;
  }

  public async Task<InventoryReserved> HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    await using var tx = await _db.BeginTransactionAsync(ct);

    try {
      // Process each item in the order
      foreach (var item in @event.Items) {
        // 1. Check available stock
        var inventory = await _db.QuerySingleOrDefaultAsync<InventoryRow>(
          """
          SELECT product_id, available_stock, reserved_stock, version
          FROM inventory
          WHERE product_id = @ProductId
          FOR UPDATE  -- Row-level lock for concurrency
          """,
          new { ProductId = item.ProductId },
          transaction: tx
        );

        if (inventory == null) {
          throw new InvalidOperationException($"Product {item.ProductId} not found");
        }

        // 2. Check if sufficient stock
        if (inventory.AvailableStock < item.Quantity) {
          // Publish InventoryInsufficient event (compensation)
          var insufficientEvent = new InventoryInsufficient(
            OrderId: @event.OrderId,
            ProductId: item.ProductId,
            RequestedQuantity: item.Quantity,
            AvailableStock: inventory.AvailableStock,
            CheckedAt: DateTime.UtcNow
          );

          // Insert into outbox for publishing
          await PublishEventAsync(insufficientEvent, tx, ct);

          _logger.LogWarning(
            "Insufficient inventory for order {OrderId}, product {ProductId}: requested {Requested}, available {Available}",
            @event.OrderId,
            item.ProductId,
            item.Quantity,
            inventory.AvailableStock
          );

          throw new InsufficientInventoryException(
            item.ProductId,
            item.Quantity,
            inventory.AvailableStock
          );
        }

        // 3. Reserve stock (optimistic concurrency via version)
        var rowsAffected = await _db.ExecuteAsync(
          """
          UPDATE inventory
          SET
            available_stock = available_stock - @Quantity,
            reserved_stock = reserved_stock + @Quantity,
            last_updated = NOW(),
            version = version + 1
          WHERE product_id = @ProductId AND version = @Version
          """,
          new {
            ProductId = item.ProductId,
            Quantity = item.Quantity,
            Version = inventory.Version
          },
          transaction: tx
        );

        if (rowsAffected == 0) {
          // Optimistic concurrency violation - retry
          throw new ConcurrencyException($"Inventory updated concurrently for product {item.ProductId}");
        }

        // 4. Create reservation record
        await _db.ExecuteAsync(
          """
          INSERT INTO inventory_reservations (
            reservation_id, order_id, product_id, quantity_reserved, status, created_at, expires_at
          )
          VALUES (@ReservationId, @OrderId, @ProductId, @Quantity, @Status, NOW(), NOW() + INTERVAL '15 minutes')
          """,
          new {
            ReservationId = Guid.NewGuid().ToString("N"),
            OrderId = @event.OrderId,
            ProductId = item.ProductId,
            Quantity = item.Quantity,
            Status = "Reserved"
          },
          transaction: tx
        );

        // 5. Publish InventoryReserved event
        var reservedEvent = new InventoryReserved(
          OrderId: @event.OrderId,
          ProductId: item.ProductId,
          QuantityReserved: item.Quantity,
          RemainingStock: inventory.AvailableStock - item.Quantity,
          ReservedAt: DateTime.UtcNow
        );

        await PublishEventAsync(reservedEvent, tx, ct);

        _logger.LogInformation(
          "Reserved {Quantity} units of product {ProductId} for order {OrderId}, remaining stock: {RemainingStock}",
          item.Quantity,
          item.ProductId,
          @event.OrderId,
          inventory.AvailableStock - item.Quantity
        );
      }

      await tx.CommitAsync(ct);

      // Return first item's event (simplification for demo)
      return new InventoryReserved(
        OrderId: @event.OrderId,
        ProductId: @event.Items[0].ProductId,
        QuantityReserved: @event.Items[0].Quantity,
        RemainingStock: 0,
        ReservedAt: DateTime.UtcNow
      );
    } catch {
      await tx.RollbackAsync(ct);
      throw;
    }
  }

  private async Task PublishEventAsync<TEvent>(
    TEvent @event,
    NpgsqlTransaction tx,
    CancellationToken ct
  ) where TEvent : IEvent {
    await _db.ExecuteAsync(
      """
      INSERT INTO outbox (message_id, message_type, message_body, created_at)
      VALUES (@MessageId, @MessageType, @MessageBody::jsonb, NOW())
      """,
      new {
        MessageId = Guid.NewGuid(),
        MessageType = typeof(TEvent).FullName,
        MessageBody = System.Text.Json.JsonSerializer.Serialize(@event)
      },
      transaction: tx
    );
  }
}

public record InventoryRow(
  string ProductId,
  int AvailableStock,
  int ReservedStock,
  int Version
);

public class InsufficientInventoryException : Exception {
  public InsufficientInventoryException(
    string productId,
    int requested,
    int available
  ) : base($"Insufficient inventory for {productId}: requested {requested}, available {available}") { }
}

public class ConcurrencyException : Exception {
  public ConcurrencyException(string message) : base(message) { }
}
```

**Key patterns**:
- ✅ **Row-Level Locking**: `FOR UPDATE` prevents concurrent stock deductions
- ✅ **Optimistic Concurrency**: `version` column detects concurrent updates
- ✅ **Compensation**: `InventoryInsufficient` event published on failure
- ✅ **Transactional**: All operations (stock update + reservation + outbox) in one transaction

---

## Step 4: Perspective (Read Model)

**ECommerce.InventoryWorker/Perspectives/InventorySummaryPerspective.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using Npgsql;
using Dapper;

namespace ECommerce.InventoryWorker.Perspectives;

public class InventorySummaryPerspective :
  IPerspectiveOf<InventoryReserved>,
  IPerspectiveOf<InventoryInsufficient> {

  private readonly NpgsqlConnection _db;
  private readonly ILogger<InventorySummaryPerspective> _logger;

  public InventorySummaryPerspective(
    NpgsqlConnection db,
    ILogger<InventorySummaryPerspective> logger
  ) {
    _db = db;
    _logger = logger;
  }

  // Handle InventoryReserved events
  public async Task HandleAsync(
    InventoryReserved @event,
    CancellationToken ct = default
  ) {
    await _db.ExecuteAsync(
      """
      INSERT INTO inventory_summary (
        product_id,
        total_reservations,
        total_reserved_quantity,
        last_reservation_at
      )
      VALUES (@ProductId, 1, @Quantity, @ReservedAt)
      ON CONFLICT (product_id) DO UPDATE SET
        total_reservations = inventory_summary.total_reservations + 1,
        total_reserved_quantity = inventory_summary.total_reserved_quantity + @Quantity,
        last_reservation_at = @ReservedAt
      """,
      new {
        ProductId = @event.ProductId,
        Quantity = @event.QuantityReserved,
        ReservedAt = @event.ReservedAt
      }
    );

    _logger.LogInformation(
      "Updated inventory summary for product {ProductId}",
      @event.ProductId
    );
  }

  // Handle InventoryInsufficient events
  public async Task HandleAsync(
    InventoryInsufficient @event,
    CancellationToken ct = default
  ) {
    await _db.ExecuteAsync(
      """
      INSERT INTO inventory_summary (
        product_id,
        total_insufficient_count,
        last_insufficient_at
      )
      VALUES (@ProductId, 1, @CheckedAt)
      ON CONFLICT (product_id) DO UPDATE SET
        total_insufficient_count = inventory_summary.total_insufficient_count + 1,
        last_insufficient_at = @CheckedAt
      """,
      new {
        ProductId = @event.ProductId,
        CheckedAt = @event.CheckedAt
      }
    );

    _logger.LogWarning(
      "Recorded insufficient inventory for product {ProductId}",
      @event.ProductId
    );
  }
}
```

**Perspective schema**:

**ECommerce.InventoryWorker/Database/Migrations/004_CreateInventorySummaryTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS inventory_summary (
  product_id TEXT PRIMARY KEY,
  total_reservations BIGINT NOT NULL DEFAULT 0,
  total_reserved_quantity BIGINT NOT NULL DEFAULT 0,
  total_insufficient_count BIGINT NOT NULL DEFAULT 0,
  last_reservation_at TIMESTAMP,
  last_insufficient_at TIMESTAMP
);

CREATE INDEX idx_inventory_summary_last_reservation ON inventory_summary(last_reservation_at DESC);
```

**Why perspectives?**
- ✅ **Denormalized Read Models**: Fast queries without joins
- ✅ **Event-Driven Updates**: Automatically updated from events
- ✅ **CQRS**: Separate read (perspective) from write (receptor) models

---

## Step 5: Worker Configuration

**ECommerce.InventoryWorker/Worker.cs**:

```csharp
using Whizbang.Core;

namespace ECommerce.InventoryWorker;

public class Worker : BackgroundService {
  private readonly IWorkCoordinator _coordinator;
  private readonly IDispatcher _dispatcher;
  private readonly ILogger<Worker> _logger;

  public Worker(
    IWorkCoordinator coordinator,
    IDispatcher dispatcher,
    ILogger<Worker> logger
  ) {
    _coordinator = coordinator;
    _dispatcher = dispatcher;
    _logger = logger;
  }

  protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
    _logger.LogInformation("Inventory Worker started");

    while (!stoppingToken.IsCancellationRequested) {
      try {
        // 1. Claim work batch from inbox
        var workBatch = await _coordinator.ProcessWorkBatchAsync(
          instanceId: Guid.NewGuid(),
          serviceName: "InventoryWorker",
          hostName: Environment.MachineName,
          processId: Environment.ProcessId,
          metadata: null,
          outboxCompletions: [],
          outboxFailures: [],
          inboxCompletions: [],
          inboxFailures: [],
          receptorCompletions: [],
          receptorFailures: [],
          perspectiveCompletions: [],
          perspectiveFailures: [],
          newOutboxMessages: [],
          newInboxMessages: [],
          renewOutboxLeaseIds: [],
          renewInboxLeaseIds: [],
          cancellationToken: stoppingToken
        );

        // 2. Process each inbox message
        foreach (var inboxMessage in workBatch.ClaimedInboxMessages) {
          var @event = DeserializeEvent(inboxMessage);
          if (@event is OrderCreated orderCreated) {
            await _dispatcher.DispatchAsync(orderCreated, stoppingToken);
          }
        }

        // 3. Poll every 5 seconds
        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
      } catch (Exception ex) when (ex is not OperationCanceledException) {
        _logger.LogError(ex, "Error in worker loop");
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
      }
    }

    _logger.LogInformation("Inventory Worker stopped");
  }

  private IEvent DeserializeEvent(InboxMessage message) {
    // Simplified deserialization (use JsonContextRegistry in production)
    return System.Text.Json.JsonSerializer.Deserialize<OrderCreated>(
      message.MessageBody.GetRawText()
    )!;
  }
}
```

**Program.cs**:

```csharp
using Whizbang.Core;
using Whizbang.Data.Postgres;
using Whizbang.Transports.AzureServiceBus;
using Npgsql;
using ECommerce.InventoryWorker;

var builder = Host.CreateApplicationBuilder(args);

// 1. Add Whizbang
builder.Services.AddWhizbang(options => {
  options.ServiceName = "InventoryWorker";
  options.EnableInbox = true;
  options.EnableOutbox = true;
});

// 2. Add PostgreSQL
builder.Services.AddScoped<NpgsqlConnection>(sp => {
  var connectionString = builder.Configuration.GetConnectionString("InventoryDb");
  return new NpgsqlConnection(connectionString);
});

// 3. Add Azure Service Bus
builder.AddAzureServiceBus("messaging");

// 4. Add Worker
builder.Services.AddHostedService<Worker>();

var host = builder.Build();

// Run migrations
await host.MigrateDatabaseAsync();

await host.RunAsync();
```

---

## Step 6: Aspire Integration

**Update ECommerce.AppHost/Program.cs**:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

// 1. PostgreSQL
var postgres = builder.AddPostgres("postgres").WithPgAdmin();
var ordersDb = postgres.AddDatabase("orders-db");
var inventoryDb = postgres.AddDatabase("inventory-db");  // NEW

// 2. Azure Service Bus
var serviceBus = builder.AddAzureServiceBus("messaging").RunAsEmulator();

// 3. Order Service
var orderService = builder.AddProject<Projects.ECommerce_OrderService_API>("order-service")
  .WithReference(ordersDb)
  .WithReference(serviceBus);

// 4. Inventory Worker (NEW)
var inventoryWorker = builder.AddProject<Projects.ECommerce_InventoryWorker>("inventory-worker")
  .WithReference(inventoryDb)
  .WithReference(serviceBus);

builder.Build().Run();
```

**appsettings.json**:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Whizbang": "Debug"
    }
  },
  "ConnectionStrings": {
    "InventoryDb": "Host=localhost;Database=inventory;Username=postgres;Password=postgres"
  },
  "Whizbang": {
    "ServiceName": "InventoryWorker",
    "Inbox": {
      "Enabled": true,
      "BatchSize": 100,
      "PollingInterval": "00:00:05"
    },
    "Outbox": {
      "Enabled": true,
      "BatchSize": 100,
      "PollingInterval": "00:00:05"
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

### 2. Create Order (Triggers Inventory Reservation)

```bash
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust-123",
    "items": [
      { "productId": "prod-456", "quantity": 2, "unitPrice": 19.99 }
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

### 3. Observe Event Flow

Check Aspire Dashboard:
1. **Order Service**: `OrderCreated` event published to Service Bus
2. **Service Bus**: Event routed to `OrderCreated` topic
3. **Inventory Worker**: Receives event from inbox
4. **Inventory Worker**: Processes event via `ReserveInventoryReceptor`
5. **Service Bus**: `InventoryReserved` event published

### 4. Verify Database

```sql
-- Check inventory (stock should be reduced)
SELECT * FROM inventory WHERE product_id = 'prod-456';

-- Check reservations
SELECT * FROM inventory_reservations WHERE product_id = 'prod-456';

-- Check perspective (read model)
SELECT * FROM inventory_summary WHERE product_id = 'prod-456';
```

**Expected**:
- `inventory.available_stock` decreased by 2
- `inventory.reserved_stock` increased by 2
- New row in `inventory_reservations`
- `inventory_summary.total_reservations` incremented

---

## Key Concepts

### Inbox Pattern (Exactly-Once Processing)

```
┌─────────────────────────────────────────────────────┐
│  Inbox Pattern - Exactly-Once Processing            │
│                                                      │
│  ┌──────────────────────────────────┐               │
│  │  Azure Service Bus               │               │
│  │  - Message delivered to worker   │               │
│  └──────────────┬───────────────────┘               │
│                 │                                    │
│                 ▼                                    │
│  ┌──────────────────────────────────┐               │
│  │  PostgreSQL Transaction          │               │
│  │                                   │               │
│  │  1. INSERT INTO inbox (msg_id)   │ ← Dedupe!    │
│  │  2. Process message (receptor)   │               │
│  │  3. UPDATE inbox SET processed   │               │
│  │                                   │               │
│  │  COMMIT;                          │               │
│  └──────────────────────────────────┘               │
│                                                      │
│  If duplicate message arrives:                      │
│  - INSERT fails (unique constraint on msg_id)       │
│  - Message skipped (already processed)              │
└─────────────────────────────────────────────────────┘
```

**Benefits**:
- ✅ **Exactly-Once**: Duplicate messages automatically skipped
- ✅ **Idempotent**: Safe to retry failed messages
- ✅ **Transactional**: Processing + inbox update atomic

### Compensation (Saga Pattern)

```
Success Flow:
OrderCreated → InventoryReserved → PaymentProcessed → ShipmentCreated

Failure Flow (Insufficient Inventory):
OrderCreated → InventoryInsufficient → CancelOrder (compensation)

Failure Flow (Payment Failed):
OrderCreated → InventoryReserved → PaymentFailed → ReleaseInventory (compensation)
```

**Compensation handler**:

**ECommerce.InventoryWorker/Receptors/ReleaseInventoryReceptor.cs**:

```csharp
public class ReleaseInventoryReceptor : IReceptor<PaymentFailed, InventoryReleased> {
  public async Task<InventoryReleased> HandleAsync(
    PaymentFailed @event,
    CancellationToken ct = default
  ) {
    await using var tx = await _db.BeginTransactionAsync(ct);

    // 1. Find reservations for this order
    var reservations = await _db.QueryAsync<ReservationRow>(
      """
      SELECT reservation_id, product_id, quantity_reserved
      FROM inventory_reservations
      WHERE order_id = @OrderId AND status = 'Reserved'
      FOR UPDATE
      """,
      new { OrderId = @event.OrderId },
      transaction: tx
    );

    foreach (var reservation in reservations) {
      // 2. Return stock to available
      await _db.ExecuteAsync(
        """
        UPDATE inventory
        SET
          available_stock = available_stock + @Quantity,
          reserved_stock = reserved_stock - @Quantity
        WHERE product_id = @ProductId
        """,
        new { reservation.ProductId, reservation.QuantityReserved },
        transaction: tx
      );

      // 3. Mark reservation as released
      await _db.ExecuteAsync(
        """
        UPDATE inventory_reservations
        SET status = 'Released'
        WHERE reservation_id = @ReservationId
        """,
        new { reservation.ReservationId },
        transaction: tx
      );
    }

    await tx.CommitAsync(ct);

    return new InventoryReleased(@event.OrderId, DateTime.UtcNow);
  }
}
```

---

## Testing

### Unit Test - Sufficient Stock

```csharp
[Test]
public async Task ReserveInventory_SufficientStock_ReservesAndPublishesEventAsync() {
  // Arrange
  var db = new MockNpgsqlConnection();
  db.SeedInventory("prod-456", availableStock: 100, reservedStock: 0);

  var receptor = new ReserveInventoryReceptor(db, mockContext, mockLogger);
  var @event = new OrderCreated(
    OrderId: "order-123",
    CustomerId: "cust-456",
    Items: [new OrderItem("prod-456", 2, 19.99m, 39.98m)],
    // ... other fields
  );

  // Act
  var result = await receptor.HandleAsync(@event);

  // Assert
  await Assert.That(result.QuantityReserved).IsEqualTo(2);
  await Assert.That(result.RemainingStock).IsEqualTo(98);

  var inventory = db.GetInventory("prod-456");
  await Assert.That(inventory.AvailableStock).IsEqualTo(98);
  await Assert.That(inventory.ReservedStock).IsEqualTo(2);
}
```

### Unit Test - Insufficient Stock

```csharp
[Test]
public async Task ReserveInventory_InsufficientStock_ThrowsExceptionAsync() {
  // Arrange
  var db = new MockNpgsqlConnection();
  db.SeedInventory("prod-456", availableStock: 1, reservedStock: 0);

  var receptor = new ReserveInventoryReceptor(db, mockContext, mockLogger);
  var @event = new OrderCreated(
    OrderId: "order-123",
    CustomerId: "cust-456",
    Items: [new OrderItem("prod-456", 2, 19.99m, 39.98m)],
    // ... other fields
  );

  // Act & Assert
  await Assert.That(async () => await receptor.HandleAsync(@event))
    .Throws<InsufficientInventoryException>();
}
```

---

## Next Steps

Continue to **[Payment Processing](payment-processing.md)** to:
- Subscribe to `InventoryReserved` events
- Implement payment gateway integration
- Publish `PaymentProcessed` events
- Handle payment failures (compensation)

---

## Key Takeaways

✅ **Inbox Pattern** - Exactly-once event processing with database deduplication
✅ **Row-Level Locking** - `FOR UPDATE` prevents race conditions
✅ **Optimistic Concurrency** - `version` column detects concurrent updates
✅ **Compensation** - `InventoryInsufficient` event triggers order cancellation
✅ **Perspectives** - Denormalized read models for fast queries
✅ **Saga Pattern** - Distributed transactions with compensating actions

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
