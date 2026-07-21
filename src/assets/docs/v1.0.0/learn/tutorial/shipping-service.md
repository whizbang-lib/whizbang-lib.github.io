---
title: Shipping Service
pageType: tutorial
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Tutorial
order: 6
description: >-
  Build the Shipping Worker - carrier API integration, shipment creation,
  tracking, and status updates
tags: 'tutorial, shipping-service, carrier-api, tracking, event-driven'
codeReferences:
  - samples/ECommerce/ECommerce.ShippingWorker/Program.cs
  - >-
    samples/ECommerce/ECommerce.ShippingWorker/Receptors/CreateShipmentReceptor.cs
  - >-
    samples/ECommerce/ECommerce.ShippingWorker/Receptors/PaymentShippingReceptor.cs
  - samples/ECommerce/ECommerce.Contracts/Commands/CreateShipmentCommand.cs
  - samples/ECommerce/ECommerce.Contracts/Events/ShipmentCreatedEvent.cs
testReferences:
  - >-
    samples/ECommerce/tests/ECommerce.ShippingWorker.Tests/CreateShipmentReceptorTests.cs
lastMaintainedCommit: '01f07906'
---

# Shipping Service

Build the **Shipping Worker** - a background service that reacts to `PaymentProcessedEvent`, dispatches `CreateShipmentCommand`, creates shipments, and publishes `ShipmentCreatedEvent` with tracking information.

:::note
This is **Part 5** of the ECommerce Tutorial. Complete [Notification Service](notification-service.md) first.
:::

---

## What You'll Build

```mermaid{caption="Shipping Service architecture — PaymentShippingReceptor turns a PaymentProcessedEvent into a CreateShipmentCommand, which CreateShipmentReceptor handles by calling the carrier and publishing ShipmentCreatedEvent through the event store and outbox."}
flowchart TD
    subgraph SSA["Shipping Service Architecture"]
        ASBIn["Azure Service Bus"]
        EventReceptor["PaymentShippingReceptor<br/>(event receptor)<br/>- Dispatch CreateShipmentCommand"]
        CmdReceptor["CreateShipmentReceptor<br/>- Call carrier API<br/>- Publish ShipmentCreatedEvent"]
        EventStore["wh_event_store (Event Store)"]
        OutboxTable["wh_outbox (Outbox)"]
        CarrierAPI["Carrier API<br/>(FedEx)"]
        ASBOut["Azure Service Bus<br/>ShipmentCreatedEvent"]

        ASBIn -->|"PaymentProcessedEvent"| EventReceptor
        EventReceptor -->|"CreateShipmentCommand"| CmdReceptor
        CmdReceptor --> CarrierAPI
        CmdReceptor --> EventStore
        CmdReceptor --> OutboxTable
        OutboxTable --> ASBOut
    end

    class ASBIn,ASBOut,OutboxTable layer-command
    class EventReceptor,CmdReceptor layer-core
    class EventStore layer-event
    class CarrierAPI layer-infrastructure
```

**Features**:
- ✅ **Events can have receptors** — react to `PaymentProcessedEvent` directly
- ✅ Event → command chaining (`PaymentProcessedEvent` → `CreateShipmentCommand`)
- ✅ Shipment creation with tracking numbers
- ✅ Carrier API abstraction (production pattern)

---

## Step 1: Define Messages

### CreateShipmentCommand

**ECommerce.Contracts/Commands/CreateShipmentCommand.cs**:

```csharp{title="CreateShipmentCommand" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "CreateShipment", "Command"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (CreateShipmentReceptorTests), which is outside the core unit-test coverage map"}
using Whizbang.Core;

namespace ECommerce.Contracts.Commands;

/// <summary>
/// Command to create a shipment after payment is processed
/// </summary>
public record CreateShipmentCommand : ICommand {
  public required string OrderId { get; init; }
  public required string ShippingAddress { get; init; }
}
```

### ShipmentCreatedEvent

**ECommerce.Contracts/Events/ShipmentCreatedEvent.cs**:

```csharp{title="ShipmentCreated Event" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "ShipmentCreated", "Event"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (CreateShipmentReceptorTests), which is outside the core unit-test coverage map"}
using Whizbang.Core;

namespace ECommerce.Contracts.Events;

/// <summary>
/// Event published when a shipment is created
/// </summary>
public record ShipmentCreatedEvent : IEvent {
  [StreamId]
  public required string OrderId { get; init; }
  public required string ShipmentId { get; init; }
  public required string TrackingNumber { get; init; }
}
```

---

## Step 2: Event Receptor (Event → Command)

**ECommerce.ShippingWorker/Receptors/PaymentShippingReceptor.cs**:

```csharp{title="Step 2: Event Receptor" description="**ECommerce." category="Example" difficulty="ADVANCED" tags=["Learn", "Tutorial", "Step", "Event"]}
using ECommerce.Contracts.Commands;
using ECommerce.Contracts.Events;
using Microsoft.Extensions.Logging;
using Whizbang.Core;

namespace ECommerce.ShippingWorker.Receptors;

/// <summary>
/// Handles PaymentProcessedEvent DIRECTLY and dispatches CreateShipmentCommand
/// This demonstrates that EVENTS can have RECEPTORS (not just perspectives!)
/// </summary>
public class PaymentShippingReceptor(IDispatcher dispatcher, ILogger<PaymentShippingReceptor> logger) : IReceptor<PaymentProcessedEvent, CreateShipmentCommand> {

  public async ValueTask<CreateShipmentCommand> HandleAsync(
    PaymentProcessedEvent message,
    CancellationToken cancellationToken = default) {

    logger.LogInformation(
      "Payment processed for order {OrderId}, initiating shipment creation",
      message.OrderId);

    // In a real system, would look up shipping address from order
    var createShipmentCommand = new CreateShipmentCommand {
      OrderId = message.OrderId,
      ShippingAddress = "123 Main St, City, State 12345"
    };

    // Dispatch the command
    await dispatcher.SendAsync(createShipmentCommand);

    logger.LogInformation(
      "Dispatched create shipment command for order {OrderId}",
      message.OrderId);

    return createShipmentCommand;
  }
}
```

`SendAsync` returns a `Task<IDeliveryReceipt>` — the command is routed to whichever service owns `ecommerce.shipping.commands` (this same worker, via the shared inbox topic).

---

## Step 3: Command Receptor

**ECommerce.ShippingWorker/Receptors/CreateShipmentReceptor.cs**:

```csharp{title="Step 3: Implement Receptor" description="**ECommerce." category="Example" difficulty="ADVANCED" tags=["Learn", "Tutorial", "Step", "Implement"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (CreateShipmentReceptorTests), which is outside the core unit-test coverage map"}
using ECommerce.Contracts.Commands;
using ECommerce.Contracts.Events;
using Microsoft.Extensions.Logging;
using Whizbang.Core;

namespace ECommerce.ShippingWorker.Receptors;

/// <summary>
/// Handles CreateShipmentCommand and publishes ShipmentCreatedEvent
/// </summary>
public class CreateShipmentReceptor(IDispatcher dispatcher, ILogger<CreateShipmentReceptor> logger) : IReceptor<CreateShipmentCommand, ShipmentCreatedEvent> {

  public async ValueTask<ShipmentCreatedEvent> HandleAsync(
    CreateShipmentCommand message,
    CancellationToken cancellationToken = default) {

    logger.LogInformation(
      "Creating shipment for order {OrderId} to address: {Address}",
      message.OrderId,
      message.ShippingAddress);

    // Simulate shipment creation
    // In a real system, this would integrate with a shipping provider API
    var shipmentCreated = new ShipmentCreatedEvent {
      OrderId = message.OrderId,
      ShipmentId = $"SHIP-{Guid.NewGuid():N}",
      TrackingNumber = $"TRK{Random.Shared.Next(100000, 999999)}"
    };

    // Publish the event
    await dispatcher.PublishAsync(shipmentCreated);

    logger.LogInformation(
      "Shipment created for order {OrderId} with tracking number {TrackingNumber}",
      message.OrderId,
      shipmentCreated.TrackingNumber);

    return shipmentCreated;
  }
}
```

:::updated
`ShipmentId`/`TrackingNumber` here are **external reference strings** (carrier-style labels), not Whizbang ids — Whizbang stream and message ids are framework-generated UUIDv7 values. Earlier drafts also hand-wrote `shipments`/`tracking_events` tables and outbox SQL; the event stream plus a perspective replaces that.
:::

---

## Step 4: Carrier API Abstraction (Production)

The sample simulates the carrier. For production, hide the carrier behind an interface — the receptor stays the same, only the injected implementation changes:

```csharp{title="Step 4: Carrier API Abstraction" description="**ECommerce." category="Example" difficulty="ADVANCED" tags=["Learn", "Tutorial", "Step", "Carrier"] unverified="production carrier abstraction — not exercised by a test"}
namespace ECommerce.ShippingWorker.Services;

public interface ICarrierService {
  Task<ShipmentResult> CreateShipmentAsync(
    ShipmentRequest request,
    CancellationToken ct = default
  );

  Task<TrackingResult> GetTrackingAsync(
    string trackingNumber,
    CancellationToken ct = default
  );
}

public record ShipmentRequest(
  string OrderId,
  string From,
  string To,
  decimal WeightPounds,
  string ServiceLevel  // "Standard", "Express", "Overnight"
);

public record ShipmentResult(
  bool Success,
  string? ShipmentId,
  string? TrackingNumber,
  string? LabelUrl,
  decimal? ShippingCost,
  DateTime? EstimatedDelivery,
  string? ErrorMessage
);

public record TrackingResult(
  string TrackingNumber,
  string Status,
  DateTime? EstimatedDelivery
);
```

A FedEx/UPS/USPS implementation is ordinary `HttpClient` code (OAuth token, POST shipment request, parse tracking/label from the response) — see the carrier's REST documentation. Wrap calls with Polly retry/circuit-breaker policies as shown in [Payment Processing](payment-processing.md).

**Tracking webhooks**: carriers push status updates to an HTTP endpoint you host. Translate each webhook into a domain event (e.g., `ShipmentStatusChangedEvent`) and publish it via `IDispatcher.PublishAsync` — then perspectives keep shipment status queryable, and the Notification worker can react to it.

---

## Step 5: Service Configuration

**ECommerce.ShippingWorker/Program.cs** (condensed from the sample):

```csharp{title="Step 5: Service Configuration" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Step", "Service"] unverified="host/DI wiring — not exercised by a test"}
using Whizbang.Core;
using Whizbang.Core.Generated;
using Whizbang.Data.EFCore.Postgres;
using Whizbang.Transports.AzureServiceBus;
using ECommerce.Contracts.Generated;
using ECommerce.ShippingWorker;
using ECommerce.ShippingWorker.Generated;

var builder = Host.CreateApplicationBuilder(args);

builder.AddServiceDefaults();

var serviceBusConnection = builder.Configuration.GetConnectionString("servicebus")
    ?? throw new InvalidOperationException("Azure Service Bus connection string 'servicebus' not found");

builder.Services.AddAzureServiceBusTransport(serviceBusConnection);
builder.Services.AddAzureServiceBusHealthChecks();

// Unified Whizbang API: routing + EF Core Postgres driver + transport consumer
_ = builder.Services
  .AddWhizbang()
  .WithRouting(routing => {
    routing
      .OwnDomains("ecommerce.shipping.commands")
      .SubscribeTo("ecommerce.orders.events")
      .Inbox.UseSharedTopic("inbox");
  })
  .WithEFCore<ShippingDbContext>()
  .WithDriver.Postgres
  .AddTransportConsumer();

builder.Services.AddReceptors();
builder.Services.AddWhizbangDispatcher();

var host = builder.Build();

using (var scope = host.Services.CreateScope()) {
  var dbContext = scope.ServiceProvider.GetRequiredService<ShippingDbContext>();
  var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
  await dbContext.EnsureWhizbangDatabaseInitializedAsync(logger);
}

host.Run();
```

---

## Step 6: Test Shipping Flow

### 1. Create Order (Full End-to-End)

```bash{title="Create Order (Full End-to-End)" description="Create Order (Full End-to-End)" category="Example" difficulty="BEGINNER" tags=["Learn", "Tutorial", "Create", "Order"]}
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{ "customerId": "...", "lineItems": [ ... ] }'
```

### 2. Observe Event Flow

Aspire Dashboard:
1. **Order Service**: `OrderCreatedEvent`
2. **Inventory Worker**: `InventoryReservedEvent`
3. **Payment Worker**: `PaymentProcessedEvent`
4. **Shipping Worker**: `PaymentShippingReceptor` → `CreateShipmentCommand` → `ShipmentCreatedEvent` (THIS STEP)
5. **Notification Worker**: shipping notification

### 3. Verify Shipment Events

```sql{title="Verify Shipment" description="Verify Shipment" category="Example" difficulty="BEGINNER" tags=["Learn", "Tutorial", "Verify", "Shipment"]}
SELECT stream_id, event_type, created_at
FROM wh_event_store
WHERE event_type LIKE '%Shipment%'
ORDER BY created_at DESC;
```

**Expected**: a `ShipmentCreatedEvent` row streamed by `OrderId`, with `SHIP-...`/`TRK...` references in the payload.

---

## Testing

**tests/ECommerce.ShippingWorker.Tests/CreateShipmentReceptorTests.cs** follows the same pattern as the other workers:

```csharp{title="Unit Test - Create Shipment" description="Unit Test - Create Shipment" category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Unit", "Test"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (CreateShipmentReceptorTests), which is outside the core unit-test coverage map"}
[Test]
public async Task HandleAsync_CreatesShipment_PublishesEventAsync() {
  // Arrange
  var dispatcher = new TestDispatcher(); // records PublishAsync calls
  var receptor = new CreateShipmentReceptor(dispatcher, NullLogger<CreateShipmentReceptor>.Instance);

  var command = new CreateShipmentCommand {
    OrderId = "order-123",
    ShippingAddress = "123 Main St, City, State 12345"
  };

  // Act
  var result = await receptor.HandleAsync(command);

  // Assert
  await Assert.That(result.OrderId).IsEqualTo("order-123");
  await Assert.That(result.ShipmentId).StartsWith("SHIP-");
  await Assert.That(result.TrackingNumber).StartsWith("TRK");
  await Assert.That(dispatcher.PublishedEvents).Count().IsEqualTo(1);
}
```

---

## Key Takeaways

✅ **Events Have Receptors** - `IReceptor<PaymentProcessedEvent, CreateShipmentCommand>` chains flows
✅ **Event → Command** - `SendAsync` routes commands to the owning service
✅ **Carrier API Abstraction** - Swap carriers easily (FedEx, UPS, USPS)
✅ **Webhook → Event** - Translate carrier callbacks into domain events
✅ **Event-Driven** - `ShipmentCreatedEvent` triggers notifications

---

## Next Steps

Continue to **[Customer Service](customer-service.md)** to:
- Build BFF (Backend for Frontend) API
- Implement perspectives for read models
- Query order summaries
- Aggregate data from multiple services

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
