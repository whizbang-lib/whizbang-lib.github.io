---
title: Testing Strategy
version: 1.0.0
category: Tutorial
order: 9
description: >-
  Comprehensive testing strategy - unit tests, integration tests, e2e tests,
  mocks, and fixtures
tags: 'tutorial, testing, unit-tests, integration-tests, e2e-tests, tunit'
---

# Testing Strategy

Build a **comprehensive testing strategy** for the ECommerce system covering unit tests, integration tests, end-to-end tests, test fixtures, and mocking patterns.

:::note
This is **Part 8** of the ECommerce Tutorial. Complete [Analytics Service](analytics-service.md) first.
:::

---

## Testing Pyramid

```
┌─────────────────────────────────────────────────────────┐
│  Testing Pyramid                                         │
│                                                          │
│              ┌────────────────┐                          │
│              │  E2E Tests     │ ← 10% (Slow, Expensive)  │
│              │  Full system   │                          │
│              └────────────────┘                          │
│         ┌───────────────────────┐                        │
│         │  Integration Tests    │ ← 30% (Medium)        │
│         │  Service + DB + Bus   │                        │
│         └───────────────────────┘                        │
│    ┌───────────────────────────────┐                     │
│    │      Unit Tests               │ ← 60% (Fast, Cheap) │
│    │  Receptors, Perspectives,     │                     │
│    │  Business Logic               │                     │
│    └───────────────────────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

---

## Unit Tests

### Testing Receptors

**ECommerce.OrderService.Tests/CreateOrderReceptorTests.cs**:

```csharp
using TUnit.Core;
using TUnit.Assertions;
using ECommerce.OrderService.API.Receptors;
using ECommerce.Contracts.Commands;
using ECommerce.Contracts.Events;
using Npgsql;
using Moq;

namespace ECommerce.OrderService.Tests;

[TestFixture]
public class CreateOrderReceptorTests {
  [Test]
  public async Task HandleAsync_ValidOrder_CreatesOrderAndPublishesEventAsync() {
    // Arrange
    var mockDb = new Mock<NpgsqlConnection>();
    var mockContext = new Mock<IMessageContext>();
    var mockLogger = new Mock<ILogger<CreateOrderReceptor>>();

    // Setup message context
    mockContext.Setup(c => c.MessageId).Returns(Guid.NewGuid());
    mockContext.Setup(c => c.CorrelationId).Returns(Guid.NewGuid());

    var receptor = new CreateOrderReceptor(
      mockDb.Object,
      mockContext.Object,
      mockLogger.Object
    );

    var command = new CreateOrder(
      CustomerId: "cust-123",
      Items: [
        new OrderItem("prod-456", 2, 19.99m)
      ],
      ShippingAddress: new Address(
        Street: "123 Main St",
        City: "Springfield",
        State: "IL",
        ZipCode: "62701",
        Country: "USA"
      )
    );

    // Act
    var result = await receptor.HandleAsync(command);

    // Assert
    await Assert.That(result).IsNotNull();
    await Assert.That(result.CustomerId).IsEqualTo("cust-123");
    await Assert.That(result.TotalAmount).IsEqualTo(39.98m);
    await Assert.That(result.Items).HasCount().EqualTo(1);
    await Assert.That(result.Items[0].LineTotal).IsEqualTo(39.98m);
  }

  [Test]
  public async Task HandleAsync_EmptyItems_ThrowsValidationExceptionAsync() {
    // Arrange
    var mockDb = new Mock<NpgsqlConnection>();
    var mockContext = new Mock<IMessageContext>();
    var mockLogger = new Mock<ILogger<CreateOrderReceptor>>();

    var receptor = new CreateOrderReceptor(
      mockDb.Object,
      mockContext.Object,
      mockLogger.Object
    );

    var command = new CreateOrder(
      CustomerId: "cust-123",
      Items: [],  // Empty items
      ShippingAddress: new Address("123 Main", "Springfield", "IL", "62701", "USA")
    );

    // Act & Assert
    await Assert.That(async () => await receptor.HandleAsync(command))
      .Throws<ValidationException>()
      .WithMessage().Contains("at least one item");
  }

  [Test]
  public async Task HandleAsync_DuplicateOrder_ReturnsExistingOrderAsync() {
    // Arrange
    var mockDb = new Mock<NpgsqlConnection>();
    // Setup to return existing order
    mockDb.Setup(db => db.QuerySingleOrDefaultAsync<OrderRow>(
      It.IsAny<string>(),
      It.IsAny<object>(),
      It.IsAny<NpgsqlTransaction>()
    )).ReturnsAsync(new OrderRow(
      OrderId: "order-existing",
      CustomerId: "cust-123",
      TotalAmount: 39.98m
    ));

    var receptor = new CreateOrderReceptor(mockDb.Object, mockContext.Object, mockLogger.Object);
    var command = new CreateOrder(...);

    // Act
    var result = await receptor.HandleAsync(command);

    // Assert
    await Assert.That(result.OrderId).IsEqualTo("order-existing");
  }
}
```

### Testing Perspectives

**ECommerce.CustomerService.Tests/OrderSummaryPerspectiveTests.cs**:

```csharp
using TUnit.Core;
using TUnit.Assertions;
using ECommerce.CustomerService.API.Perspectives;
using ECommerce.Contracts.Events;
using Npgsql;
using Dapper;
using Moq;

namespace ECommerce.CustomerService.Tests;

[TestFixture]
public class OrderSummaryPerspectiveTests {
  [Test]
  public async Task HandleAsync_OrderCreated_InsertsOrderSummaryAsync() {
    // Arrange
    var mockDb = new Mock<NpgsqlConnection>();
    var mockLogger = new Mock<ILogger<OrderSummaryPerspective>>();

    var perspective = new OrderSummaryPerspective(
      mockDb.Object,
      mockLogger.Object
    );

    var @event = new OrderCreated(
      OrderId: "order-123",
      CustomerId: "cust-456",
      Items: [
        new OrderItem("prod-789", 2, 19.99m, 39.98m)
      ],
      ShippingAddress: new Address("123 Main", "Springfield", "IL", "62701", "USA"),
      TotalAmount: 39.98m,
      CreatedAt: DateTime.UtcNow
    );

    // Act
    await perspective.HandleAsync(@event);

    // Assert
    mockDb.Verify(db => db.ExecuteAsync(
      It.Is<string>(sql => sql.Contains("INSERT INTO order_summary")),
      It.Is<object>(param =>
        ((dynamic)param).OrderId == "order-123" &&
        ((dynamic)param).TotalAmount == 39.98m
      ),
      It.IsAny<NpgsqlTransaction>(),
      It.IsAny<int>(),
      It.IsAny<CommandType>()
    ), Times.Once);
  }

  [Test]
  public async Task HandleAsync_PaymentProcessed_UpdatesOrderSummaryAsync() {
    // Arrange
    var mockDb = new Mock<NpgsqlConnection>();
    var mockLogger = new Mock<ILogger<OrderSummaryPerspective>>();

    var perspective = new OrderSummaryPerspective(
      mockDb.Object,
      mockLogger.Object
    );

    var @event = new PaymentProcessed(
      OrderId: "order-123",
      PaymentId: "pay-456",
      TransactionId: "txn-789",
      Amount: 39.98m,
      PaymentMethod: "card",
      Status: PaymentStatus.Captured,
      ProcessedAt: DateTime.UtcNow
    );

    // Act
    await perspective.HandleAsync(@event);

    // Assert
    mockDb.Verify(db => db.ExecuteAsync(
      It.Is<string>(sql => sql.Contains("UPDATE order_summary")),
      It.Is<object>(param =>
        ((dynamic)param).OrderId == "order-123" &&
        ((dynamic)param).PaymentId == "pay-456"
      ),
      It.IsAny<NpgsqlTransaction>(),
      It.IsAny<int>(),
      It.IsAny<CommandType>()
    ), Times.Once);
  }
}
```

---

## Integration Tests

### Testing with Test Database

**ECommerce.OrderService.IntegrationTests/CreateOrderIntegrationTests.cs**:

```csharp
using TUnit.Core;
using TUnit.Assertions;
using Microsoft.AspNetCore.Mvc.Testing;
using ECommerce.OrderService.API;
using ECommerce.Contracts.Commands;
using System.Net.Http.Json;

namespace ECommerce.OrderService.IntegrationTests;

[TestFixture]
public class CreateOrderIntegrationTests : IAsyncDisposable {
  private WebApplicationFactory<Program> _factory;
  private HttpClient _client;

  [Before(Test)]
  public async Task SetupAsync() {
    _factory = new WebApplicationFactory<Program>()
      .WithWebHostBuilder(builder => {
        builder.ConfigureServices(services => {
          // Override connection string to use test database
          services.Configure<ConnectionStrings>(options => {
            options.OrdersDb = "Host=localhost;Database=orders_test;Username=postgres;Password=postgres";
          });
        });
      });

    _client = _factory.CreateClient();

    // Clean database before each test
    await CleanDatabaseAsync();
  }

  [After(Test)]
  public async Task TeardownAsync() {
    await CleanDatabaseAsync();
  }

  [Test]
  public async Task POST_CreateOrder_ReturnsCreatedStatusAsync() {
    // Arrange
    var command = new {
      customerId = "cust-123",
      items = new[] {
        new { productId = "prod-456", quantity = 2, unitPrice = 19.99 }
      },
      shippingAddress = new {
        street = "123 Main St",
        city = "Springfield",
        state = "IL",
        zipCode = "62701",
        country = "USA"
      }
    };

    // Act
    var response = await _client.PostAsJsonAsync("/api/orders", command);

    // Assert
    await Assert.That(response.StatusCode).IsEqualTo(HttpStatusCode.Created);

    var result = await response.Content.ReadFromJsonAsync<OrderCreated>();
    await Assert.That(result).IsNotNull();
    await Assert.That(result!.CustomerId).IsEqualTo("cust-123");
    await Assert.That(result.TotalAmount).IsEqualTo(39.98m);
  }

  [Test]
  public async Task POST_CreateOrder_SavesOrderToDatabase_AndPublishesToOutboxAsync() {
    // Arrange
    var command = new { ... };

    // Act
    var response = await _client.PostAsJsonAsync("/api/orders", command);
    var result = await response.Content.ReadFromJsonAsync<OrderCreated>();

    // Assert - Query database directly
    using var connection = new NpgsqlConnection("Host=localhost;Database=orders_test;...");
    await connection.OpenAsync();

    // Check order exists
    var order = await connection.QuerySingleOrDefaultAsync<OrderRow>(
      "SELECT * FROM orders WHERE order_id = @OrderId",
      new { OrderId = result!.OrderId }
    );
    await Assert.That(order).IsNotNull();

    // Check outbox entry exists
    var outboxMessage = await connection.QuerySingleOrDefaultAsync<OutboxRow>(
      "SELECT * FROM outbox WHERE message_type = @MessageType",
      new { MessageType = typeof(OrderCreated).FullName }
    );
    await Assert.That(outboxMessage).IsNotNull();
  }

  private async Task CleanDatabaseAsync() {
    using var connection = new NpgsqlConnection("Host=localhost;Database=orders_test;...");
    await connection.OpenAsync();
    await connection.ExecuteAsync("TRUNCATE TABLE orders, order_items, outbox CASCADE");
  }

  public async ValueTask DisposeAsync() {
    await _client.DisposeAsync();
    await _factory.DisposeAsync();
  }
}
```

### Testing Event Flow

**ECommerce.IntegrationTests/OrderToPaymentFlowTests.cs**:

```csharp
using TUnit.Core;
using TUnit.Assertions;
using Whizbang.Testing;

namespace ECommerce.IntegrationTests;

[TestFixture]
public class OrderToPaymentFlowTests {
  private TestHarness _harness;

  [Before(Test)]
  public async Task SetupAsync() {
    _harness = new TestHarness()
      .AddService<OrderService>()
      .AddService<InventoryWorker>()
      .AddService<PaymentWorker>()
      .UseInMemoryServiceBus();

    await _harness.StartAsync();
  }

  [After(Test)]
  public async Task TeardownAsync() {
    await _harness.StopAsync();
  }

  [Test]
  public async Task CreateOrder_WithSufficientInventory_ProcessesPaymentAsync() {
    // Arrange
    var command = new CreateOrder(...);

    // Act
    var orderCreatedEvent = await _harness.SendCommandAsync<CreateOrder, OrderCreated>(command);

    // Wait for event propagation
    await _harness.WaitForEventAsync<InventoryReserved>(
      e => e.OrderId == orderCreatedEvent.OrderId,
      timeout: TimeSpan.FromSeconds(10)
    );

    await _harness.WaitForEventAsync<PaymentProcessed>(
      e => e.OrderId == orderCreatedEvent.OrderId,
      timeout: TimeSpan.FromSeconds(10)
    );

    // Assert
    var events = _harness.GetPublishedEvents();
    await Assert.That(events).HasCount().EqualTo(3);  // OrderCreated, InventoryReserved, PaymentProcessed

    var paymentEvent = events.OfType<PaymentProcessed>().Single();
    await Assert.That(paymentEvent.Status).IsEqualTo(PaymentStatus.Captured);
  }
}
```

---

## End-to-End Tests

**ECommerce.E2ETests/FullOrderLifecycleTests.cs**:

```csharp
using TUnit.Core;
using TUnit.Assertions;
using Testcontainers.PostgreSql;
using Testcontainers.AzuriteServiceBus;

namespace ECommerce.E2ETests;

[TestFixture]
public class FullOrderLifecycleTests : IAsyncDisposable {
  private PostgreSqlContainer _postgresContainer;
  private AzuriteServiceBusContainer _serviceBusContainer;
  private HttpClient _orderServiceClient;
  private HttpClient _customerServiceClient;

  [Before(Test)]
  public async Task SetupAsync() {
    // Start containers
    _postgresContainer = new PostgreSqlBuilder()
      .WithImage("postgres:16")
      .Build();

    _serviceBusContainer = new AzuriteServiceBusBuilder()
      .WithImage("mcr.microsoft.com/azure-messaging/servicebus-emulator")
      .Build();

    await _postgresContainer.StartAsync();
    await _serviceBusContainer.StartAsync();

    // Start services with container connection strings
    _orderServiceClient = await StartServiceAsync<OrderService>(
      connectionString: _postgresContainer.GetConnectionString(),
      serviceBusConnectionString: _serviceBusContainer.GetConnectionString()
    );

    _customerServiceClient = await StartServiceAsync<CustomerService>(
      connectionString: _postgresContainer.GetConnectionString(),
      serviceBusConnectionString: _serviceBusContainer.GetConnectionString()
    );

    // Other services...
  }

  [Test]
  public async Task CreateOrder_FullLifecycle_CompletesSuccessfullyAsync() {
    // Arrange
    var command = new {
      customerId = "cust-123",
      items = new[] {
        new { productId = "prod-456", quantity = 2, unitPrice = 19.99 }
      },
      shippingAddress = new {
        street = "123 Main St",
        city = "Springfield",
        state = "IL",
        zipCode = "62701",
        country = "USA"
      }
    };

    // Act
    var createResponse = await _orderServiceClient.PostAsJsonAsync("/api/orders", command);
    var orderCreated = await createResponse.Content.ReadFromJsonAsync<OrderCreated>();

    // Wait for processing (eventually consistent)
    await Task.Delay(TimeSpan.FromSeconds(15));

    // Query order summary from Customer Service (read model)
    var orderSummary = await _customerServiceClient.GetFromJsonAsync<OrderSummaryDto>(
      $"/api/orders/{orderCreated!.OrderId}"
    );

    // Assert
    await Assert.That(orderSummary).IsNotNull();
    await Assert.That(orderSummary!.Status).IsEqualTo("Shipped");
    await Assert.That(orderSummary.PaymentInfo).IsNotNull();
    await Assert.That(orderSummary.PaymentInfo!.Status).IsEqualTo("Captured");
    await Assert.That(orderSummary.ShipmentInfo).IsNotNull();
    await Assert.That(orderSummary.ShipmentInfo!.TrackingNumber).IsNotNull();
  }

  public async ValueTask DisposeAsync() {
    await _postgresContainer.StopAsync();
    await _serviceBusContainer.StopAsync();
    await _postgresContainer.DisposeAsync();
    await _serviceBusContainer.DisposeAsync();
  }
}
```

---

## Test Fixtures

**ECommerce.Testing/Fixtures/OrderFixture.cs**:

```csharp
using Bogus;
using ECommerce.Contracts.Commands;
using ECommerce.Contracts.Events;

namespace ECommerce.Testing.Fixtures;

public static class OrderFixture {
  private static readonly Faker<CreateOrder> CreateOrderFaker = new Faker<CreateOrder>()
    .CustomInstantiator(f => new CreateOrder(
      CustomerId: f.Random.AlphaNumeric(10),
      Items: Enumerable.Range(0, f.Random.Int(1, 5))
        .Select(_ => new OrderItem(
          ProductId: f.Commerce.Product(),
          Quantity: f.Random.Int(1, 10),
          UnitPrice: f.Finance.Amount(5, 100)
        ))
        .ToArray(),
      ShippingAddress: new Address(
        Street: f.Address.StreetAddress(),
        City: f.Address.City(),
        State: f.Address.StateAbbr(),
        ZipCode: f.Address.ZipCode(),
        Country: "USA"
      )
    ));

  public static CreateOrder GenerateCreateOrderCommand() {
    return CreateOrderFaker.Generate();
  }

  public static CreateOrder[] GenerateCreateOrderCommands(int count) {
    return CreateOrderFaker.Generate(count).ToArray();
  }
}
```

**Usage**:

```csharp
[Test]
public async Task SomeTest_WithRandomData_WorksCorrectlyAsync() {
  // Arrange
  var command = OrderFixture.GenerateCreateOrderCommand();

  // Act
  var result = await receptor.HandleAsync(command);

  // Assert
  await Assert.That(result).IsNotNull();
}
```

---

## Mocking External Services

**ECommerce.Testing/Mocks/MockPaymentGateway.cs**:

```csharp
using ECommerce.PaymentWorker.Services;

namespace ECommerce.Testing.Mocks;

public class MockPaymentGateway : IPaymentGateway {
  private readonly List<PaymentResult> _results = [];

  public void SetupSuccessfulCharge(string transactionId) {
    _results.Add(new PaymentResult(
      Success: true,
      TransactionId: transactionId,
      ErrorCode: null,
      ErrorMessage: null
    ));
  }

  public void SetupFailedCharge(string errorCode, string errorMessage) {
    _results.Add(new PaymentResult(
      Success: false,
      TransactionId: null,
      ErrorCode: errorCode,
      ErrorMessage: errorMessage
    ));
  }

  public Task<PaymentResult> ChargeAsync(
    string idempotencyKey,
    decimal amount,
    string currency,
    string paymentMethod,
    CancellationToken ct = default
  ) {
    if (_results.Count == 0) {
      throw new InvalidOperationException("No payment results configured");
    }

    var result = _results[0];
    _results.RemoveAt(0);
    return Task.FromResult(result);
  }

  public Task<RefundResult> RefundAsync(
    string transactionId,
    decimal amount,
    CancellationToken ct = default
  ) {
    return Task.FromResult(new RefundResult(
      Success: true,
      RefundId: Guid.NewGuid().ToString("N"),
      ErrorMessage: null
    ));
  }
}
```

---

## Test Coverage

### Running Tests with Coverage

```bash
cd ECommerce.OrderService.Tests
dotnet run -- --coverage --coverage-output-format cobertura --coverage-output coverage.xml
```

### Coverage Targets

| Component | Target | Rationale |
|-----------|--------|-----------|
| **Receptors** | 90%+ | Core business logic |
| **Perspectives** | 80%+ | Event handling logic |
| **Controllers** | 70%+ | HTTP API endpoints |
| **Services** | 80%+ | Infrastructure code |

---

## Key Takeaways

✅ **Testing Pyramid** - 60% unit, 30% integration, 10% e2e
✅ **Test Fixtures** - Bogus for test data generation
✅ **Mock External Services** - Isolate unit tests from dependencies
✅ **Integration Tests** - Test with real database and message bus
✅ **E2E Tests** - Testcontainers for full environment simulation
✅ **Test Coverage** - 80%+ for core business logic

---

## Next Steps

Continue to **[Deployment](deployment.md)** to:
- Deploy to Azure Kubernetes Service (AKS)
- Configure CI/CD pipelines
- Set up monitoring and alerting
- Implement blue-green deployments

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
