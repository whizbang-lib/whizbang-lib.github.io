---
title: Payment Processing Service
version: 1.0.0
category: Tutorial
order: 4
description: >-
  Build the Payment Worker - payment gateway integration, distributed
  transactions, and compensation
tags: >-
  tutorial, payment-service, distributed-transactions, saga-pattern,
  compensation
---

# Payment Processing Service

Build the **Payment Worker** - a background service that subscribes to `InventoryReserved` events, processes payments via external gateway, and handles failures with compensation.

:::note
This is **Part 3** of the ECommerce Tutorial. Complete [Inventory Service](inventory-service.md) first.
:::

---

## What You'll Build

```
┌─────────────────────────────────────────────────────────────┐
│  Payment Service Architecture                               │
│                                                              │
│  ┌─────────────┐                                            │
│  │Azure Service│  InventoryReserved event                   │
│  │     Bus     │──────────────────────┐                     │
│  └─────────────┘                      │                     │
│                                        ▼                     │
│                          ┌────────────────────────┐         │
│                          │  Inbox Pattern         │         │
│                          └──────────┬─────────────┘         │
│                                     │                        │
│                                     ▼                        │
│                          ┌────────────────────────┐         │
│                          │ ProcessPaymentReceptor │         │
│                          │  - Call gateway API    │         │
│                          │  - Retry logic         │         │
│                          │  - Store transaction   │         │
│                          └──────────┬─────────────┘         │
│                                     │                        │
│                      ┌──────────────┼──────────────┐        │
│                      │              │              │        │
│                      ▼              ▼              ▼        │
│                 ┌─────────┐   ┌─────────┐   ┌──────────┐   │
│                 │Postgres │   │ Outbox  │   │ Payment  │   │
│                 │Payments │   │ Table   │   │ Gateway  │   │
│                 │  Table  │   │         │   │   API    │   │
│                 └─────────┘   └─────────┘   └──────────┘   │
│                                     │                        │
│                      ┌──────────────┼──────────────┐        │
│                      │              │              │        │
│                      ▼              ▼              ▼        │
│              ┌──────────────┐  ┌──────────────┐  ┌────────┐│
│              │PaymentProcessed│ │PaymentFailed │ │Outbox  ││
│              │     Event      │ │    Event     │ │Worker  ││
│              └──────────────┘  └──────────────┘  └────────┘│
└─────────────────────────────────────────────────────────────┘
```

**Features**:
- ✅ Payment gateway integration (Stripe example)
- ✅ Retry logic with exponential backoff
- ✅ Idempotency (payment deduplication)
- ✅ Distributed transaction coordination
- ✅ Compensation (refunds on failure)
- ✅ Circuit breaker pattern

---

## Step 1: Define Events

### PaymentProcessed Event

**ECommerce.Contracts/Events/PaymentProcessed.cs**:

```csharp
using Whizbang.Core;

namespace ECommerce.Contracts.Events;

public record PaymentProcessed(
  string OrderId,
  string PaymentId,
  string TransactionId,
  decimal Amount,
  string PaymentMethod,
  PaymentStatus Status,
  DateTime ProcessedAt
) : IEvent;

public enum PaymentStatus {
  Authorized,
  Captured,
  Failed,
  Refunded
}
```

### PaymentFailed Event (Compensation)

**ECommerce.Contracts/Events/PaymentFailed.cs**:

```csharp
using Whizbang.Core;

namespace ECommerce.Contracts.Events;

public record PaymentFailed(
  string OrderId,
  string PaymentId,
  string Reason,
  string ErrorCode,
  DateTime FailedAt
) : IEvent;
```

---

## Step 2: Database Schema

### Payments Table

**ECommerce.PaymentWorker/Database/Migrations/001_CreatePaymentsTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS payments (
  payment_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,  -- One payment per order
  transaction_id TEXT,  -- External gateway transaction ID
  amount NUMERIC(10, 2) NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL,
  gateway_response JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_transaction_id ON payments(transaction_id);
CREATE INDEX idx_payments_status ON payments(status);
```

---

## Step 3: Payment Gateway Abstraction

**ECommerce.PaymentWorker/Services/IPaymentGateway.cs**:

```csharp
namespace ECommerce.PaymentWorker.Services;

public interface IPaymentGateway {
  Task<PaymentResult> ChargeAsync(
    string idempotencyKey,
    decimal amount,
    string currency,
    string paymentMethod,
    CancellationToken ct = default
  );

  Task<RefundResult> RefundAsync(
    string transactionId,
    decimal amount,
    CancellationToken ct = default
  );
}

public record PaymentResult(
  bool Success,
  string? TransactionId,
  string? ErrorCode,
  string? ErrorMessage
);

public record RefundResult(
  bool Success,
  string? RefundId,
  string? ErrorMessage
);
```

### Stripe Implementation

**ECommerce.PaymentWorker/Services/StripePaymentGateway.cs**:

```csharp
using Stripe;

namespace ECommerce.PaymentWorker.Services;

public class StripePaymentGateway : IPaymentGateway {
  private readonly PaymentIntentService _paymentIntentService;
  private readonly RefundService _refundService;
  private readonly ILogger<StripePaymentGateway> _logger;

  public StripePaymentGateway(
    PaymentIntentService paymentIntentService,
    RefundService refundService,
    ILogger<StripePaymentGateway> logger
  ) {
    _paymentIntentService = paymentIntentService;
    _refundService = refundService;
    _logger = logger;
  }

  public async Task<PaymentResult> ChargeAsync(
    string idempotencyKey,
    decimal amount,
    string currency,
    string paymentMethod,
    CancellationToken ct = default
  ) {
    try {
      var options = new PaymentIntentCreateOptions {
        Amount = (long)(amount * 100), // Stripe uses cents
        Currency = currency.ToLowerInvariant(),
        PaymentMethod = paymentMethod,
        Confirm = true,
        AutomaticPaymentMethods = new PaymentIntentAutomaticPaymentMethodsOptions {
          Enabled = true,
          AllowRedirects = "never"
        }
      };

      var requestOptions = new RequestOptions {
        IdempotencyKey = idempotencyKey  // Prevents duplicate charges
      };

      var intent = await _paymentIntentService.CreateAsync(
        options,
        requestOptions,
        ct
      );

      if (intent.Status == "succeeded") {
        return new PaymentResult(
          Success: true,
          TransactionId: intent.Id,
          ErrorCode: null,
          ErrorMessage: null
        );
      } else {
        return new PaymentResult(
          Success: false,
          TransactionId: intent.Id,
          ErrorCode: intent.Status,
          ErrorMessage: $"Payment intent status: {intent.Status}"
        );
      }
    } catch (StripeException ex) {
      _logger.LogError(ex, "Stripe payment failed: {ErrorCode}", ex.StripeError?.Code);

      return new PaymentResult(
        Success: false,
        TransactionId: null,
        ErrorCode: ex.StripeError?.Code ?? "unknown",
        ErrorMessage: ex.Message
      );
    }
  }

  public async Task<RefundResult> RefundAsync(
    string transactionId,
    decimal amount,
    CancellationToken ct = default
  ) {
    try {
      var options = new RefundCreateOptions {
        PaymentIntent = transactionId,
        Amount = (long)(amount * 100)
      };

      var refund = await _refundService.CreateAsync(options, cancellationToken: ct);

      return new RefundResult(
        Success: refund.Status == "succeeded",
        RefundId: refund.Id,
        ErrorMessage: refund.Status == "failed" ? refund.FailureReason : null
      );
    } catch (StripeException ex) {
      _logger.LogError(ex, "Stripe refund failed: {ErrorCode}", ex.StripeError?.Code);

      return new RefundResult(
        Success: false,
        RefundId: null,
        ErrorMessage: ex.Message
      );
    }
  }
}
```

---

## Step 4: Implement Receptor

**ECommerce.PaymentWorker/Receptors/ProcessPaymentReceptor.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using ECommerce.PaymentWorker.Services;
using Npgsql;
using Dapper;
using Polly;
using Polly.CircuitBreaker;

namespace ECommerce.PaymentWorker.Receptors;

public class ProcessPaymentReceptor : IReceptor<InventoryReserved, PaymentProcessed> {
  private readonly NpgsqlConnection _db;
  private readonly IPaymentGateway _gateway;
  private readonly IMessageContext _context;
  private readonly ILogger<ProcessPaymentReceptor> _logger;

  // Retry policy: 3 attempts with exponential backoff
  private static readonly AsyncPolicy<PaymentResult> RetryPolicy = Policy
    .Handle<HttpRequestException>()
    .Or<TaskCanceledException>()
    .OrResult<PaymentResult>(r => !r.Success && r.ErrorCode == "network_error")
    .WaitAndRetryAsync(
      retryCount: 3,
      sleepDurationProvider: attempt => TimeSpan.FromSeconds(Math.Pow(2, attempt)),
      onRetry: (outcome, timespan, retryCount, context) => {
        Console.WriteLine($"Payment retry {retryCount} after {timespan}");
      }
    );

  // Circuit breaker: Open after 5 consecutive failures, half-open after 30s
  private static readonly AsyncCircuitBreakerPolicy CircuitBreakerPolicy = Policy
    .Handle<HttpRequestException>()
    .CircuitBreakerAsync(
      exceptionsAllowedBeforeBreaking: 5,
      durationOfBreak: TimeSpan.FromSeconds(30),
      onBreak: (ex, duration) => {
        Console.WriteLine($"Circuit breaker opened for {duration}");
      },
      onReset: () => {
        Console.WriteLine("Circuit breaker reset");
      }
    );

  public ProcessPaymentReceptor(
    NpgsqlConnection db,
    IPaymentGateway gateway,
    IMessageContext context,
    ILogger<ProcessPaymentReceptor> logger
  ) {
    _db = db;
    _gateway = gateway;
    _context = context;
    _logger = logger;
  }

  public async Task<PaymentProcessed> HandleAsync(
    InventoryReserved @event,
    CancellationToken ct = default
  ) {
    await using var tx = await _db.BeginTransactionAsync(ct);

    try {
      // 1. Check if payment already exists (idempotency)
      var existingPayment = await _db.QuerySingleOrDefaultAsync<PaymentRow>(
        """
        SELECT payment_id, order_id, transaction_id, amount, status
        FROM payments
        WHERE order_id = @OrderId
        """,
        new { OrderId = @event.OrderId },
        transaction: tx
      );

      if (existingPayment != null) {
        _logger.LogInformation(
          "Payment already exists for order {OrderId}, skipping",
          @event.OrderId
        );

        return new PaymentProcessed(
          OrderId: existingPayment.OrderId,
          PaymentId: existingPayment.PaymentId,
          TransactionId: existingPayment.TransactionId!,
          Amount: existingPayment.Amount,
          PaymentMethod: "card",
          Status: PaymentStatus.Captured,
          ProcessedAt: DateTime.UtcNow
        );
      }

      // 2. Get order details (to determine amount)
      var order = await GetOrderAsync(@event.OrderId, ct);
      if (order == null) {
        throw new InvalidOperationException($"Order {event.OrderId} not found");
      }

      // 3. Call payment gateway with retry + circuit breaker
      var paymentId = Guid.NewGuid().ToString("N");
      var idempotencyKey = $"order-{@event.OrderId}-payment-{paymentId}";

      var result = await CircuitBreakerPolicy.ExecuteAsync(() =>
        RetryPolicy.ExecuteAsync(() =>
          _gateway.ChargeAsync(
            idempotencyKey: idempotencyKey,
            amount: order.TotalAmount,
            currency: "usd",
            paymentMethod: "pm_card_visa",  // Demo: Use test payment method
            ct: ct
          )
        )
      );

      // 4. Store payment record
      if (result.Success) {
        await _db.ExecuteAsync(
          """
          INSERT INTO payments (
            payment_id, order_id, transaction_id, amount, payment_method, status, gateway_response, created_at, updated_at
          )
          VALUES (@PaymentId, @OrderId, @TransactionId, @Amount, @PaymentMethod, @Status, @GatewayResponse::jsonb, NOW(), NOW())
          """,
          new {
            PaymentId = paymentId,
            OrderId = @event.OrderId,
            TransactionId = result.TransactionId,
            Amount = order.TotalAmount,
            PaymentMethod = "card",
            Status = "Captured",
            GatewayResponse = System.Text.Json.JsonSerializer.Serialize(result)
          },
          transaction: tx
        );

        // 5. Publish PaymentProcessed event
        var processedEvent = new PaymentProcessed(
          OrderId: @event.OrderId,
          PaymentId: paymentId,
          TransactionId: result.TransactionId!,
          Amount: order.TotalAmount,
          PaymentMethod: "card",
          Status: PaymentStatus.Captured,
          ProcessedAt: DateTime.UtcNow
        );

        await PublishEventAsync(processedEvent, tx, ct);

        await tx.CommitAsync(ct);

        _logger.LogInformation(
          "Payment processed for order {OrderId}, transaction {TransactionId}, amount ${Amount}",
          @event.OrderId,
          result.TransactionId,
          order.TotalAmount
        );

        return processedEvent;
      } else {
        // 6. Payment failed - store failure and publish PaymentFailed event
        await _db.ExecuteAsync(
          """
          INSERT INTO payments (
            payment_id, order_id, amount, payment_method, status, gateway_response, created_at, updated_at
          )
          VALUES (@PaymentId, @OrderId, @Amount, @PaymentMethod, @Status, @GatewayResponse::jsonb, NOW(), NOW())
          """,
          new {
            PaymentId = paymentId,
            OrderId = @event.OrderId,
            Amount = order.TotalAmount,
            PaymentMethod = "card",
            Status = "Failed",
            GatewayResponse = System.Text.Json.JsonSerializer.Serialize(result)
          },
          transaction: tx
        );

        var failedEvent = new PaymentFailed(
          OrderId: @event.OrderId,
          PaymentId: paymentId,
          Reason: result.ErrorMessage ?? "Unknown error",
          ErrorCode: result.ErrorCode ?? "unknown",
          FailedAt: DateTime.UtcNow
        );

        await PublishEventAsync(failedEvent, tx, ct);

        await tx.CommitAsync(ct);

        _logger.LogError(
          "Payment failed for order {OrderId}: {ErrorCode} - {ErrorMessage}",
          @event.OrderId,
          result.ErrorCode,
          result.ErrorMessage
        );

        throw new PaymentFailedException(
          @event.OrderId,
          result.ErrorCode ?? "unknown",
          result.ErrorMessage ?? "Unknown error"
        );
      }
    } catch {
      await tx.RollbackAsync(ct);
      throw;
    }
  }

  private async Task<OrderRow?> GetOrderAsync(string orderId, CancellationToken ct) {
    // Query Order Service database (cross-service query for demo)
    // In production, use event-carried state transfer or query API
    return await _db.QuerySingleOrDefaultAsync<OrderRow>(
      """
      SELECT order_id, total_amount
      FROM orders
      WHERE order_id = @OrderId
      """,
      new { OrderId = orderId }
    );
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

public record PaymentRow(
  string PaymentId,
  string OrderId,
  string? TransactionId,
  decimal Amount,
  string Status
);

public record OrderRow(
  string OrderId,
  decimal TotalAmount
);

public class PaymentFailedException : Exception {
  public PaymentFailedException(string orderId, string errorCode, string message)
    : base($"Payment failed for order {orderId}: {errorCode} - {message}") { }
}
```

**Key patterns**:
- ✅ **Idempotency**: Check existing payment before charging
- ✅ **Retry Logic**: Polly retry policy with exponential backoff
- ✅ **Circuit Breaker**: Polly circuit breaker to prevent cascading failures
- ✅ **Compensation**: Publish `PaymentFailed` event to trigger inventory release

---

## Step 5: Compensation Receptor

**ECommerce.PaymentWorker/Receptors/RefundPaymentReceptor.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using ECommerce.PaymentWorker.Services;
using Npgsql;
using Dapper;

namespace ECommerce.PaymentWorker.Receptors;

public class RefundPaymentReceptor : IReceptor<OrderCancelled, PaymentRefunded> {
  private readonly NpgsqlConnection _db;
  private readonly IPaymentGateway _gateway;
  private readonly ILogger<RefundPaymentReceptor> _logger;

  public RefundPaymentReceptor(
    NpgsqlConnection db,
    IPaymentGateway gateway,
    ILogger<RefundPaymentReceptor> logger
  ) {
    _db = db;
    _gateway = gateway;
    _logger = logger;
  }

  public async Task<PaymentRefunded> HandleAsync(
    OrderCancelled @event,
    CancellationToken ct = default
  ) {
    await using var tx = await _db.BeginTransactionAsync(ct);

    try {
      // 1. Find payment for this order
      var payment = await _db.QuerySingleOrDefaultAsync<PaymentRow>(
        """
        SELECT payment_id, order_id, transaction_id, amount, status
        FROM payments
        WHERE order_id = @OrderId AND status = 'Captured'
        """,
        new { OrderId = @event.OrderId },
        transaction: tx
      );

      if (payment == null) {
        _logger.LogWarning(
          "No captured payment found for order {OrderId}, skipping refund",
          @event.OrderId
        );
        throw new InvalidOperationException($"No payment to refund for order {event.OrderId}");
      }

      // 2. Call payment gateway for refund
      var result = await _gateway.RefundAsync(
        transactionId: payment.TransactionId!,
        amount: payment.Amount,
        ct: ct
      );

      if (result.Success) {
        // 3. Update payment status
        await _db.ExecuteAsync(
          """
          UPDATE payments
          SET status = 'Refunded', updated_at = NOW()
          WHERE payment_id = @PaymentId
          """,
          new { PaymentId = payment.PaymentId },
          transaction: tx
        );

        // 4. Publish PaymentRefunded event
        var refundedEvent = new PaymentRefunded(
          OrderId: @event.OrderId,
          PaymentId: payment.PaymentId,
          RefundId: result.RefundId!,
          Amount: payment.Amount,
          RefundedAt: DateTime.UtcNow
        );

        await PublishEventAsync(refundedEvent, tx, ct);

        await tx.CommitAsync(ct);

        _logger.LogInformation(
          "Payment refunded for order {OrderId}, refund {RefundId}, amount ${Amount}",
          @event.OrderId,
          result.RefundId,
          payment.Amount
        );

        return refundedEvent;
      } else {
        throw new RefundFailedException(
          @event.OrderId,
          result.ErrorMessage ?? "Refund failed"
        );
      }
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

public record PaymentRefunded(
  string OrderId,
  string PaymentId,
  string RefundId,
  decimal Amount,
  DateTime RefundedAt
) : IEvent;

public class RefundFailedException : Exception {
  public RefundFailedException(string orderId, string message)
    : base($"Refund failed for order {orderId}: {message}") { }
}
```

---

## Step 6: Service Configuration

**ECommerce.PaymentWorker/Program.cs**:

```csharp
using Whizbang.Core;
using Whizbang.Data.Postgres;
using Whizbang.Transports.AzureServiceBus;
using Npgsql;
using Stripe;
using ECommerce.PaymentWorker.Services;

var builder = Host.CreateApplicationBuilder(args);

// 1. Add Whizbang
builder.Services.AddWhizbang(options => {
  options.ServiceName = "PaymentWorker";
  options.EnableInbox = true;
  options.EnableOutbox = true;
});

// 2. Add PostgreSQL
builder.Services.AddScoped<NpgsqlConnection>(sp => {
  var connectionString = builder.Configuration.GetConnectionString("PaymentDb");
  return new NpgsqlConnection(connectionString);
});

// 3. Add Azure Service Bus
builder.AddAzureServiceBus("messaging");

// 4. Configure Stripe
StripeConfiguration.ApiKey = builder.Configuration["Stripe:SecretKey"];
builder.Services.AddSingleton<PaymentIntentService>();
builder.Services.AddSingleton<RefundService>();
builder.Services.AddScoped<IPaymentGateway, StripePaymentGateway>();

// 5. Add Worker
builder.Services.AddHostedService<Worker>();

var host = builder.Build();

await host.MigrateDatabaseAsync();
await host.RunAsync();
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
    "PaymentDb": "Host=localhost;Database=payment;Username=postgres;Password=postgres"
  },
  "Stripe": {
    "SecretKey": "sk_test_...",
    "PublishableKey": "pk_test_..."
  },
  "Whizbang": {
    "ServiceName": "PaymentWorker",
    "Inbox": {
      "Enabled": true,
      "BatchSize": 50,
      "PollingInterval": "00:00:05"
    },
    "Outbox": {
      "Enabled": true,
      "BatchSize": 50,
      "PollingInterval": "00:00:05"
    }
  }
}
```

---

## Step 7: Test the Flow

### 1. Update Aspire Configuration

**ECommerce.AppHost/Program.cs**:

```csharp
var paymentDb = postgres.AddDatabase("payment-db");

var paymentWorker = builder.AddProject<Projects.ECommerce_PaymentWorker>("payment-worker")
  .WithReference(paymentDb)
  .WithReference(serviceBus);
```

### 2. Create Order (Full Flow)

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

### 3. Observe Distributed Transaction

Aspire Dashboard shows:
1. **Order Service**: `OrderCreated` event published
2. **Inventory Worker**: `InventoryReserved` event published
3. **Payment Worker**: Payment processed via Stripe
4. **Payment Worker**: `PaymentProcessed` event published

### 4. Verify Payment

```sql
SELECT * FROM payments WHERE order_id = '<order-id>';
```

**Expected**:
- `status = 'Captured'`
- `transaction_id = 'pi_...'` (Stripe payment intent ID)
- `gateway_response` contains full Stripe response

---

## Key Concepts

### Saga Pattern - Distributed Transactions

```
┌─────────────────────────────────────────────────────────┐
│  Saga: Order Processing (Happy Path)                    │
│                                                          │
│  1. CreateOrder → OrderCreated                          │
│       ↓                                                  │
│  2. OrderCreated → ReserveInventory → InventoryReserved │
│       ↓                                                  │
│  3. InventoryReserved → ProcessPayment → PaymentProcessed│
│       ↓                                                  │
│  4. PaymentProcessed → CreateShipment → ShipmentCreated │
│       ↓                                                  │
│  5. ShipmentCreated → SendNotification → NotificationSent│
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Saga: Payment Failure (Compensation)                   │
│                                                          │
│  1. CreateOrder → OrderCreated                          │
│       ↓                                                  │
│  2. OrderCreated → ReserveInventory → InventoryReserved │
│       ↓                                                  │
│  3. InventoryReserved → ProcessPayment → PaymentFailed  │
│       ↓                                                  │
│  4. PaymentFailed → ReleaseInventory → InventoryReleased│
│       ↓                                                  │
│  5. InventoryReleased → CancelOrder → OrderCancelled    │
└─────────────────────────────────────────────────────────┘
```

**Compensating transactions**:
- `PaymentFailed` → `ReleaseInventory` (return stock to available)
- `OrderCancelled` → `RefundPayment` (refund customer)

### Retry Logic with Polly

```csharp
// Exponential backoff: 2s, 4s, 8s
Policy
  .Handle<HttpRequestException>()
  .WaitAndRetryAsync(
    retryCount: 3,
    sleepDurationProvider: attempt => TimeSpan.FromSeconds(Math.Pow(2, attempt))
  );
```

**When to retry**:
- ✅ Network errors (transient)
- ✅ Gateway timeouts (transient)
- ❌ Invalid card (permanent)
- ❌ Insufficient funds (permanent)

### Circuit Breaker

```csharp
// Open circuit after 5 failures, half-open after 30s
Policy
  .Handle<HttpRequestException>()
  .CircuitBreakerAsync(
    exceptionsAllowedBeforeBreaking: 5,
    durationOfBreak: TimeSpan.FromSeconds(30)
  );
```

**States**:
- **Closed**: Normal operation
- **Open**: Gateway unavailable, fail fast
- **Half-Open**: Test if gateway recovered

---

## Testing

### Unit Test - Successful Payment

```csharp
[Test]
public async Task ProcessPayment_ValidCard_ChargesAndPublishesEventAsync() {
  // Arrange
  var mockGateway = new MockPaymentGateway();
  mockGateway.SetupSuccessfulCharge("pi_123456");

  var receptor = new ProcessPaymentReceptor(mockDb, mockGateway, mockContext, mockLogger);
  var @event = new InventoryReserved(
    OrderId: "order-123",
    ProductId: "prod-456",
    QuantityReserved: 2,
    RemainingStock: 98,
    ReservedAt: DateTime.UtcNow
  );

  // Act
  var result = await receptor.HandleAsync(@event);

  // Assert
  await Assert.That(result.Status).IsEqualTo(PaymentStatus.Captured);
  await Assert.That(result.TransactionId).IsEqualTo("pi_123456");
}
```

### Unit Test - Payment Failure

```csharp
[Test]
public async Task ProcessPayment_InvalidCard_PublishesPaymentFailedEventAsync() {
  // Arrange
  var mockGateway = new MockPaymentGateway();
  mockGateway.SetupFailedCharge("card_declined", "Your card was declined");

  var receptor = new ProcessPaymentReceptor(mockDb, mockGateway, mockContext, mockLogger);
  var @event = new InventoryReserved(...);

  // Act & Assert
  await Assert.That(async () => await receptor.HandleAsync(@event))
    .Throws<PaymentFailedException>();

  // Verify PaymentFailed event was published
  var outboxEvent = mockDb.GetOutboxEvents().Single();
  await Assert.That(outboxEvent.MessageType).Contains("PaymentFailed");
}
```

---

## Next Steps

Continue to **[Notification Service](notification-service.md)** to:
- Subscribe to `PaymentProcessed` events
- Send order confirmation emails
- Integrate with email/SMS providers
- Handle notification failures gracefully

---

## Key Takeaways

✅ **Idempotency** - Prevent duplicate charges with idempotency keys
✅ **Retry Logic** - Exponential backoff for transient failures
✅ **Circuit Breaker** - Fail fast when gateway is down
✅ **Saga Pattern** - Distributed transactions with compensation
✅ **Gateway Abstraction** - Swap payment providers easily
✅ **Compensation** - Refunds and inventory release on failure

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
