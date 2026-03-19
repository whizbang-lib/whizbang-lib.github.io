---
title: Microservices Orchestration
version: 1.0.0
category: Customization Examples
order: 3
description: >-
  Implement saga orchestration patterns - distributed workflows, compensation,
  and process managers
tags: 'sagas, orchestration, process-managers, distributed-workflows, compensation'
---

# Microservices Orchestration

Implement **saga orchestration patterns** with Whizbang for distributed workflows, compensation handling, and complex multi-service coordination.

---

## Orchestration vs. Choreography

```
┌────────────────────────────────────────────────────────────┐
│  Choreography (Decentralized)                              │
│                                                             │
│  OrderService → OrderCreated → InventoryService            │
│                                      ↓                      │
│                            InventoryReserved                │
│                                      ↓                      │
│                              PaymentService                 │
│                                      ↓                      │
│                             PaymentProcessed                │
│                                                             │
│  ❌ No central coordinator                                 │
│  ❌ Hard to track overall state                            │
│  ✅ Loose coupling                                         │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  Orchestration (Centralized)                               │
│                                                             │
│           ┌──────────────────────┐                         │
│           │ OrderSaga            │                         │
│           │ (Process Manager)    │                         │
│           └──────────┬───────────┘                         │
│                      │                                      │
│         ┌────────────┼────────────┐                        │
│         │            │            │                        │
│         ▼            ▼            ▼                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │Inventory │  │ Payment  │  │ Shipping │                │
│  │ Service  │  │ Service  │  │ Service  │                │
│  └──────────┘  └──────────┘  └──────────┘                │
│                                                             │
│  ✅ Central coordinator                                    │
│  ✅ Easy to track state                                    │
│  ✅ Complex workflows                                      │
│  ❌ Tighter coupling                                       │
└────────────────────────────────────────────────────────────┘
```

---

## Saga State Machine

**OrderSagaState.cs**:

```csharp
public record OrderSagaState {
  public required string SagaId { get; init; }
  public required string OrderId { get; init; }
  public required SagaStatus Status { get; init; }
  public required SagaStep CurrentStep { get; init; }
  public string? PaymentId { get; init; }
  public string? ShipmentId { get; init; }
  public string? ErrorMessage { get; init; }
  public DateTime CreatedAt { get; init; }
  public DateTime UpdatedAt { get; init; }
  public Dictionary<string, string> Metadata { get; init; } = new();
}

public enum SagaStatus {
  Started,
  InProgress,
  Completed,
  Compensating,
  Compensated,
  Failed
}

public enum SagaStep {
  OrderCreated,
  InventoryReserving,
  InventoryReserved,
  PaymentProcessing,
  PaymentProcessed,
  ShipmentCreating,
  ShipmentCreated,
  OrderCompleted
}
```

---

## Saga Orchestrator

**OrderSagaOrchestrator.cs**:

```csharp
public class OrderSagaOrchestrator :
  IPerspectiveOf<OrderCreated>,
  IPerspectiveOf<InventoryReserved>,
  IPerspectiveOf<InventoryInsufficient>,
  IPerspectiveOf<PaymentProcessed>,
  IPerspectiveOf<PaymentFailed>,
  IPerspectiveOf<ShipmentCreated> {

  private readonly NpgsqlConnection _db;
  private readonly IMessageBus _bus;
  private readonly ILogger<OrderSagaOrchestrator> _logger;

  // Handle OrderCreated - Start saga
  public async Task HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    var sagaId = Guid.NewGuid().ToString("N");

    // 1. Create saga state
    var state = new OrderSagaState {
      SagaId = sagaId,
      OrderId = @event.OrderId,
      Status = SagaStatus.InProgress,
      CurrentStep = SagaStep.InventoryReserving,
      CreatedAt = DateTime.UtcNow,
      UpdatedAt = DateTime.UtcNow
    };

    await SaveSagaStateAsync(state, ct);

    // 2. Send first command
    var reserveInventoryCommand = new ReserveInventory(
      OrderId: @event.OrderId,
      Items: @event.Items
    );

    await _bus.SendCommandAsync(reserveInventoryCommand, ct);

    _logger.LogInformation(
      "Order saga {SagaId} started for order {OrderId}",
      sagaId,
      @event.OrderId
    );
  }

  // Handle InventoryReserved - Continue saga
  public async Task HandleAsync(
    InventoryReserved @event,
    CancellationToken ct = default
  ) {
    var state = await LoadSagaStateByOrderIdAsync(@event.OrderId, ct);
    if (state == null) {
      _logger.LogWarning("Saga not found for order {OrderId}", @event.OrderId);
      return;
    }

    // Update state
    state = state with {
      CurrentStep = SagaStep.PaymentProcessing,
      UpdatedAt = DateTime.UtcNow
    };
    await SaveSagaStateAsync(state, ct);

    // Send next command
    var processPaymentCommand = new ProcessPayment(
      OrderId: @event.OrderId,
      Amount: @event.TotalAmount
    );

    await _bus.SendCommandAsync(processPaymentCommand, ct);

    _logger.LogInformation(
      "Saga {SagaId}: Inventory reserved, processing payment",
      state.SagaId
    );
  }

  // Handle InventoryInsufficient - Compensate
  public async Task HandleAsync(
    InventoryInsufficient @event,
    CancellationToken ct = default
  ) {
    var state = await LoadSagaStateByOrderIdAsync(@event.OrderId, ct);
    if (state == null) return;

    // Update state to compensating
    state = state with {
      Status = SagaStatus.Compensating,
      CurrentStep = SagaStep.OrderCreated,
      ErrorMessage = $"Insufficient inventory for product {@event.ProductId}",
      UpdatedAt = DateTime.UtcNow
    };
    await SaveSagaStateAsync(state, ct);

    // Send compensation command
    var cancelOrderCommand = new CancelOrder(
      OrderId: @event.OrderId,
      Reason: "Insufficient inventory"
    );

    await _bus.SendCommandAsync(cancelOrderCommand, ct);

    _logger.LogWarning(
      "Saga {SagaId}: Insufficient inventory, compensating",
      state.SagaId
    );
  }

  // Handle PaymentProcessed - Continue saga
  public async Task HandleAsync(
    PaymentProcessed @event,
    CancellationToken ct = default
  ) {
    var state = await LoadSagaStateByOrderIdAsync(@event.OrderId, ct);
    if (state == null) return;

    // Update state
    state = state with {
      CurrentStep = SagaStep.ShipmentCreating,
      PaymentId = @event.PaymentId,
      UpdatedAt = DateTime.UtcNow
    };
    await SaveSagaStateAsync(state, ct);

    // Send next command
    var createShipmentCommand = new CreateShipment(
      OrderId: @event.OrderId,
      PaymentId: @event.PaymentId
    );

    await _bus.SendCommandAsync(createShipmentCommand, ct);

    _logger.LogInformation(
      "Saga {SagaId}: Payment processed, creating shipment",
      state.SagaId
    );
  }

  // Handle PaymentFailed - Compensate
  public async Task HandleAsync(
    PaymentFailed @event,
    CancellationToken ct = default
  ) {
    var state = await LoadSagaStateByOrderIdAsync(@event.OrderId, ct);
    if (state == null) return;

    // Update state to compensating
    state = state with {
      Status = SagaStatus.Compensating,
      CurrentStep = SagaStep.InventoryReserved,
      ErrorMessage = @event.Reason,
      UpdatedAt = DateTime.UtcNow
    };
    await SaveSagaStateAsync(state, ct);

    // Send compensation command
    var releaseInventoryCommand = new ReleaseInventory(
      OrderId: @event.OrderId
    );

    await _bus.SendCommandAsync(releaseInventoryCommand, ct);

    _logger.LogWarning(
      "Saga {SagaId}: Payment failed, releasing inventory",
      state.SagaId
    );
  }

  // Handle ShipmentCreated - Complete saga
  public async Task HandleAsync(
    ShipmentCreated @event,
    CancellationToken ct = default
  ) {
    var state = await LoadSagaStateByOrderIdAsync(@event.OrderId, ct);
    if (state == null) return;

    // Update state to completed
    state = state with {
      Status = SagaStatus.Completed,
      CurrentStep = SagaStep.OrderCompleted,
      ShipmentId = @event.ShipmentId,
      UpdatedAt = DateTime.UtcNow
    };
    await SaveSagaStateAsync(state, ct);

    _logger.LogInformation(
      "Saga {SagaId}: Order completed successfully",
      state.SagaId
    );
  }

  private async Task SaveSagaStateAsync(
    OrderSagaState state,
    CancellationToken ct
  ) {
    await _db.ExecuteAsync(
      """
      INSERT INTO saga_state (
        saga_id, order_id, status, current_step, payment_id, shipment_id, error_message, created_at, updated_at, metadata
      )
      VALUES (@SagaId, @OrderId, @Status, @CurrentStep, @PaymentId, @ShipmentId, @ErrorMessage, @CreatedAt, @UpdatedAt, @Metadata::jsonb)
      ON CONFLICT (saga_id) DO UPDATE SET
        status = @Status,
        current_step = @CurrentStep,
        payment_id = @PaymentId,
        shipment_id = @ShipmentId,
        error_message = @ErrorMessage,
        updated_at = @UpdatedAt
      """,
      new {
        state.SagaId,
        state.OrderId,
        Status = state.Status.ToString(),
        CurrentStep = state.CurrentStep.ToString(),
        state.PaymentId,
        state.ShipmentId,
        state.ErrorMessage,
        state.CreatedAt,
        state.UpdatedAt,
        Metadata = JsonSerializer.Serialize(state.Metadata)
      }
    );
  }

  private async Task<OrderSagaState?> LoadSagaStateByOrderIdAsync(
    string orderId,
    CancellationToken ct
  ) {
    return await _db.QuerySingleOrDefaultAsync<OrderSagaState>(
      """
      SELECT saga_id, order_id, status, current_step, payment_id, shipment_id, error_message, created_at, updated_at
      FROM saga_state
      WHERE order_id = @OrderId
      """,
      new { OrderId = orderId }
    );
  }
}
```

---

## Saga Database Schema

**Migrations/001_CreateSagaTables.sql**:

```sql
CREATE TABLE saga_state (
  saga_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  current_step TEXT NOT NULL,
  payment_id TEXT,
  shipment_id TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_saga_state_order_id ON saga_state(order_id);
CREATE INDEX idx_saga_state_status ON saga_state(status);
CREATE INDEX idx_saga_state_created_at ON saga_state(created_at DESC);
```

---

## Timeout Handling

**Saga timeouts for hung processes**:

**SagaTimeoutMonitor.cs**:

```csharp
public class SagaTimeoutMonitor : BackgroundService {
  private readonly NpgsqlConnection _db;
  private readonly IMessageBus _bus;
  private readonly ILogger<SagaTimeoutMonitor> _logger;

  protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
    while (!stoppingToken.IsCancellationRequested) {
      try {
        // Find sagas stuck in progress for > 10 minutes
        var stuckSagas = await _db.QueryAsync<OrderSagaState>(
          """
          SELECT saga_id, order_id, status, current_step, updated_at
          FROM saga_state
          WHERE status = 'InProgress'
            AND updated_at < NOW() - INTERVAL '10 minutes'
          """
        );

        foreach (var saga in stuckSagas) {
          _logger.LogWarning(
            "Saga {SagaId} timed out at step {CurrentStep}, compensating",
            saga.SagaId,
            saga.CurrentStep
          );

          // Trigger compensation
          await CompensateSagaAsync(saga, stoppingToken);
        }

        await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
      } catch (Exception ex) when (ex is not OperationCanceledException) {
        _logger.LogError(ex, "Error in saga timeout monitor");
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
      }
    }
  }

  private async Task CompensateSagaAsync(
    OrderSagaState saga,
    CancellationToken ct
  ) {
    // Send compensation commands based on current step
    switch (saga.CurrentStep) {
      case SagaStep.PaymentProcessing:
        // Release inventory
        await _bus.SendCommandAsync(
          new ReleaseInventory(saga.OrderId),
          ct
        );
        break;

      case SagaStep.ShipmentCreating:
        // Refund payment and release inventory
        await _bus.SendCommandAsync(
          new RefundPayment(saga.OrderId, saga.PaymentId!),
          ct
        );
        await _bus.SendCommandAsync(
          new ReleaseInventory(saga.OrderId),
          ct
        );
        break;
    }

    // Update saga to compensating
    await _db.ExecuteAsync(
      """
      UPDATE saga_state
      SET status = 'Compensating', error_message = 'Timeout', updated_at = NOW()
      WHERE saga_id = @SagaId
      """,
      new { SagaId = saga.SagaId }
    );
  }
}
```

---

## Saga Visualization API

**SagasController.cs**:

```csharp
[ApiController]
[Route("api/[controller]")]
public class SagasController : ControllerBase {
  private readonly NpgsqlConnection _db;

  [HttpGet("{sagaId}")]
  public async Task<IActionResult> GetSaga(string sagaId) {
    var saga = await _db.QuerySingleOrDefaultAsync<OrderSagaState>(
      "SELECT * FROM saga_state WHERE saga_id = @SagaId",
      new { SagaId = sagaId }
    );

    if (saga == null) {
      return NotFound();
    }

    return Ok(new {
      saga.SagaId,
      saga.OrderId,
      saga.Status,
      saga.CurrentStep,
      saga.PaymentId,
      saga.ShipmentId,
      saga.ErrorMessage,
      saga.CreatedAt,
      saga.UpdatedAt,
      Steps = GetSagaSteps(saga)
    });
  }

  private object[] GetSagaSteps(OrderSagaState saga) {
    var steps = new[] {
      new { Step = "OrderCreated", Status = "Completed", Timestamp = saga.CreatedAt },
      new { Step = "InventoryReserving", Status = GetStepStatus(saga, SagaStep.InventoryReserving), Timestamp = (DateTime?)null },
      new { Step = "InventoryReserved", Status = GetStepStatus(saga, SagaStep.InventoryReserved), Timestamp = (DateTime?)null },
      new { Step = "PaymentProcessing", Status = GetStepStatus(saga, SagaStep.PaymentProcessing), Timestamp = (DateTime?)null },
      new { Step = "PaymentProcessed", Status = GetStepStatus(saga, SagaStep.PaymentProcessed), Timestamp = (DateTime?)null },
      new { Step = "ShipmentCreating", Status = GetStepStatus(saga, SagaStep.ShipmentCreating), Timestamp = (DateTime?)null },
      new { Step = "ShipmentCreated", Status = GetStepStatus(saga, SagaStep.ShipmentCreated), Timestamp = (DateTime?)null }
    };

    return steps;
  }

  private string GetStepStatus(OrderSagaState saga, SagaStep step) {
    if (saga.CurrentStep == step) return "InProgress";
    if ((int)saga.CurrentStep > (int)step) return "Completed";
    return "Pending";
  }
}
```

**Response**:

```json
{
  "sagaId": "abc123",
  "orderId": "order-456",
  "status": "InProgress",
  "currentStep": "PaymentProcessing",
  "steps": [
    { "step": "OrderCreated", "status": "Completed", "timestamp": "2024-12-12T10:00:00Z" },
    { "step": "InventoryReserving", "status": "Completed", "timestamp": "2024-12-12T10:01:00Z" },
    { "step": "InventoryReserved", "status": "Completed", "timestamp": "2024-12-12T10:02:00Z" },
    { "step": "PaymentProcessing", "status": "InProgress", "timestamp": null },
    { "step": "PaymentProcessed", "status": "Pending", "timestamp": null },
    { "step": "ShipmentCreating", "status": "Pending", "timestamp": null },
    { "step": "ShipmentCreated", "status": "Pending", "timestamp": null }
  ]
}
```

---

## Key Takeaways

✅ **Centralized Coordination** - Saga orchestrator manages workflow
✅ **State Tracking** - Saga state persisted at each step
✅ **Compensation** - Automatic rollback on failures
✅ **Timeout Handling** - Monitor and compensate hung sagas
✅ **Visualization** - API for tracking saga progress

---

## When to Use Orchestration

| Scenario | Orchestration | Choreography |
|----------|--------------|--------------|
| **Simple workflows** | ❌ Overkill | ✅ Recommended |
| **Complex workflows** | ✅ Recommended | ❌ Hard to track |
| **Long-running processes** | ✅ Recommended | ❌ No visibility |
| **High failure rates** | ✅ Better control | ❌ Hard to compensate |
| **Loose coupling** | ❌ Tighter coupling | ✅ Decoupled |

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
