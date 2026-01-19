---
title: "Testing Receptors & Perspectives"
version: 0.1.0
category: Advanced Topics
order: 2
description: "Unit testing patterns for receptors and perspectives - mocking, fixtures, and test strategies"
tags: testing, unit-tests, mocking, tunit, fixtures
---

# Testing Receptors & Perspectives

Comprehensive **testing strategies** for receptors and perspectives using TUnit, mocking patterns, test fixtures, and integration testing techniques.

---

## Testing Philosophy

| Layer | Test Type | Coverage Target | Speed |
|-------|-----------|----------------|-------|
| **Receptors** | Unit Tests | 100% | < 10ms |
| **Perspectives** | Unit Tests | 100% | < 10ms |
| **Integration** | Integration Tests | Happy paths + error cases | < 500ms |
| **End-to-End** | E2E Tests | Critical user journeys | < 5s |

---

## Testing Stack

**Whizbang uses modern .NET testing tools**:

```xml
<ItemGroup>
  <PackageReference Include="TUnit" Version="1.0.0" />
  <PackageReference Include="TUnit.Assertions" Version="1.0.0" />
  <PackageReference Include="Rocks" Version="8.0.0" />
  <PackageReference Include="Bogus" Version="35.0.0" />
  <PackageReference Include="Testcontainers" Version="4.0.0" />
</ItemGroup>
```

**Why these tools?**:
- **TUnit** - Modern source-generation test framework (faster than xUnit)
- **TUnit.Assertions** - Fluent assertions native to TUnit
- **Rocks** - Source-generation mocking (AOT-compatible, faster than Moq)
- **Bogus** - Test data generation
- **Testcontainers** - Docker-based integration tests

---

## Unit Testing Receptors

### Basic Receptor Test

**CreateOrderReceptorTests.cs**:

```csharp
using TUnit.Assertions;
using TUnit.Core;

public class CreateOrderReceptorTests {
  [Test]
  public async Task HandleAsync_ValidOrder_ReturnsOrderCreated() {
    // Arrange
    var command = new CreateOrder {
      CustomerId = "cust-123",
      Items = [
        new OrderItem { ProductId = "prod-456", Quantity = 2, UnitPrice = 19.99m }
      ]
    };

    var mockDb = Rock.Create<IDbConnection>();
    mockDb.Methods(m => m.ExecuteAsync(Arg.Any<string>(), Arg.Any<object>(), Arg.Any<IDbTransaction>()))
      .Returns(Task.FromResult(1));

    var receptor = new CreateOrderReceptor(mockDb.Instance(), Mock.Of<ILogger<CreateOrderReceptor>>());

    // Act
    var result = await receptor.HandleAsync(command);

    // Assert
    await Assert.That(result).IsNotNull();
    await Assert.That(result.OrderId).IsNotNull();
    await Assert.That(result.CustomerId).IsEqualTo("cust-123");
    await Assert.That(result.TotalAmount).IsEqualTo(39.98m);
  }

  [Test]
  public async Task HandleAsync_EmptyOrder_ThrowsValidationException() {
    // Arrange
    var command = new CreateOrder {
      CustomerId = "cust-123",
      Items = []  // Empty items
    };

    var receptor = new CreateOrderReceptor(Mock.Of<IDbConnection>(), Mock.Of<ILogger<CreateOrderReceptor>>());

    // Act & Assert
    await Assert.That(() => receptor.HandleAsync(command))
      .ThrowsExactly<ValidationException>()
      .WithMessage("Order must contain at least one item");
  }
}
```

---

## Mocking with Rocks

**Rocks** generates mocks at compile-time using source generators (AOT-compatible):

### Database Mocking

```csharp
[Test]
public async Task HandleAsync_DatabaseFailure_ThrowsException() {
  // Arrange
  var mockDb = Rock.Create<IDbConnection>();
  mockDb.Methods(m => m.BeginTransactionAsync(Arg.Any<CancellationToken>()))
    .Throws<InvalidOperationException>();

  var receptor = new CreateOrderReceptor(mockDb.Instance(), Mock.Of<ILogger<CreateOrderReceptor>>());
  var command = CreateValidOrder();

  // Act & Assert
  await Assert.That(() => receptor.HandleAsync(command))
    .ThrowsExactly<InvalidOperationException>();
}
```

### Service Bus Mocking

```csharp
[Test]
public async Task HandleAsync_PublishesToServiceBus() {
  // Arrange
  var mockSender = Rock.Create<ServiceBusSender>();
  var capturedMessage = default(ServiceBusMessage);

  mockSender.Methods(m => m.SendMessageAsync(Arg.Any<ServiceBusMessage>(), Arg.Any<CancellationToken>()))
    .Callback<ServiceBusMessage, CancellationToken>((msg, ct) => {
      capturedMessage = msg;
      return Task.CompletedTask;
    });

  var receptor = new CreateOrderReceptor(Mock.Of<IDbConnection>(), mockSender.Instance());
  var command = CreateValidOrder();

  // Act
  await receptor.HandleAsync(command);

  // Assert
  await Assert.That(capturedMessage).IsNotNull();
  await Assert.That(capturedMessage.Subject).IsEqualTo("OrderCreated");
}
```

---

## Test Data Generation with Bogus

**OrderTestData.cs**:

```csharp
using Bogus;

public static class OrderTestData {
  private static readonly Faker<CreateOrder> OrderFaker = new Faker<CreateOrder>()
    .RuleFor(o => o.CustomerId, f => $"cust-{f.Random.Guid()}")
    .RuleFor(o => o.Items, f => new[] {
      new OrderItem {
        ProductId = $"prod-{f.Random.Guid()}",
        Quantity = f.Random.Int(1, 10),
        UnitPrice = f.Finance.Amount(10, 100)
      }
    });

  public static CreateOrder CreateValidOrder() => OrderFaker.Generate();

  public static CreateOrder CreateOrderWithItems(int itemCount) {
    var order = OrderFaker.Generate();
    order.Items = Enumerable.Range(0, itemCount)
      .Select(_ => new OrderItem {
        ProductId = $"prod-{Guid.NewGuid()}",
        Quantity = Random.Shared.Next(1, 10),
        UnitPrice = Random.Shared.Next(10, 100)
      })
      .ToArray();
    return order;
  }
}
```

**Usage**:

```csharp
[Test]
public async Task HandleAsync_MultipleItems_CalculatesTotalCorrectly() {
  // Arrange
  var order = OrderTestData.CreateOrderWithItems(5);
  var expectedTotal = order.Items.Sum(i => i.Quantity * i.UnitPrice);

  var receptor = new CreateOrderReceptor(Mock.Of<IDbConnection>());

  // Act
  var result = await receptor.HandleAsync(order);

  // Assert
  await Assert.That(result.TotalAmount).IsEqualTo(expectedTotal);
}
```

---

## Unit Testing Perspectives

### Basic Perspective Test

**OrderSummaryPerspectiveTests.cs**:

```csharp
public class OrderSummaryPerspectiveTests {
  [Test]
  public async Task HandleAsync_OrderCreated_InsertsOrderSummary() {
    // Arrange
    var @event = new OrderCreated {
      OrderId = "order-123",
      CustomerId = "cust-456",
      TotalAmount = 99.99m,
      CreatedAt = DateTime.UtcNow
    };

    var mockDb = Rock.Create<IDbConnection>();
    var capturedSql = default(string);
    var capturedParams = default(object);

    mockDb.Methods(m => m.ExecuteAsync(Arg.Any<string>(), Arg.Any<object>(), Arg.Any<IDbTransaction>()))
      .Callback<string, object, IDbTransaction>((sql, param, tx) => {
        capturedSql = sql;
        capturedParams = param;
        return Task.FromResult(1);
      });

    var perspective = new OrderSummaryPerspective(mockDb.Instance());

    // Act
    await perspective.HandleAsync(@event);

    // Assert
    await Assert.That(capturedSql).Contains("INSERT INTO order_summary");
    await Assert.That(capturedParams).IsNotNull();
  }

  [Test]
  public async Task HandleAsync_PaymentProcessed_UpdatesOrderSummary() {
    // Arrange
    var @event = new PaymentProcessed {
      OrderId = "order-123",
      PaymentId = "pay-789",
      Amount = 99.99m,
      ProcessedAt = DateTime.UtcNow
    };

    var mockDb = Rock.Create<IDbConnection>();
    var capturedSql = default(string);

    mockDb.Methods(m => m.ExecuteAsync(Arg.Any<string>(), Arg.Any<object>(), Arg.Any<IDbTransaction>()))
      .Callback<string, object, IDbTransaction>((sql, param, tx) => {
        capturedSql = sql;
        return Task.FromResult(1);
      });

    var perspective = new OrderSummaryPerspective(mockDb.Instance());

    // Act
    await perspective.HandleAsync(@event);

    // Assert
    await Assert.That(capturedSql).Contains("UPDATE order_summary");
    await Assert.That(capturedSql).Contains("payment_id = @PaymentId");
  }
}
```

---

## Test Fixtures

**Shared test infrastructure**:

**DatabaseFixture.cs**:

```csharp
public class DatabaseFixture : IAsyncLifetime {
  public IDbConnection Connection { get; private set; } = null!;

  public async Task InitializeAsync() {
    Connection = new NpgsqlConnection("Host=localhost;Database=test_db;");
    await Connection.OpenAsync();

    // Create schema
    await Connection.ExecuteAsync("""
      CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        total_amount DECIMAL(18,2) NOT NULL,
        created_at TIMESTAMP NOT NULL
      )
      """);
  }

  public async Task DisposeAsync() {
    // Clean up
    await Connection.ExecuteAsync("DROP TABLE IF EXISTS orders");
    await Connection.DisposeAsync();
  }
}
```

**Usage**:

```csharp
public class CreateOrderReceptorIntegrationTests : IClassFixture<DatabaseFixture> {
  private readonly DatabaseFixture _fixture;

  public CreateOrderReceptorIntegrationTests(DatabaseFixture fixture) {
    _fixture = fixture;
  }

  [Test]
  public async Task HandleAsync_WithRealDatabase_InsertsOrder() {
    // Arrange
    var receptor = new CreateOrderReceptor(_fixture.Connection);
    var command = OrderTestData.CreateValidOrder();

    // Act
    var result = await receptor.HandleAsync(command);

    // Assert
    var inserted = await _fixture.Connection.QuerySingleOrDefaultAsync<OrderRow>(
      "SELECT * FROM orders WHERE order_id = @OrderId",
      new { OrderId = result.OrderId }
    );

    await Assert.That(inserted).IsNotNull();
    await Assert.That(inserted.CustomerId).IsEqualTo(command.CustomerId);
  }
}
```

---

## Integration Testing with Testcontainers

**PostgreSQL Container**:

```csharp
using Testcontainers.PostgreSql;

public class PostgresIntegrationTests : IAsyncLifetime {
  private PostgreSqlContainer _postgres = null!;
  private IDbConnection _connection = null!;

  public async Task InitializeAsync() {
    _postgres = new PostgreSqlBuilder()
      .WithImage("postgres:16")
      .WithDatabase("test_db")
      .WithUsername("postgres")
      .WithPassword("postgres")
      .Build();

    await _postgres.StartAsync();

    _connection = new NpgsqlConnection(_postgres.GetConnectionString());
    await _connection.OpenAsync();

    // Run migrations
    await _connection.ExecuteAsync(File.ReadAllText("schema.sql"));
  }

  [Test]
  public async Task HandleAsync_WithPostgres_FullIntegration() {
    // Arrange
    var receptor = new CreateOrderReceptor(_connection);
    var command = OrderTestData.CreateValidOrder();

    // Act
    var result = await receptor.HandleAsync(command);

    // Assert
    var order = await _connection.QuerySingleAsync<OrderRow>(
      "SELECT * FROM orders WHERE order_id = @OrderId",
      new { OrderId = result.OrderId }
    );

    await Assert.That(order.TotalAmount).IsEqualTo(result.TotalAmount);
  }

  public async Task DisposeAsync() {
    await _connection.DisposeAsync();
    await _postgres.DisposeAsync();
  }
}
```

**Azure Service Bus Container**:

```csharp
using Testcontainers.Azurite;

public class ServiceBusIntegrationTests : IAsyncLifetime {
  private AzuriteContainer _azurite = null!;
  private ServiceBusClient _client = null!;

  public async Task InitializeAsync() {
    _azurite = new AzuriteBuilder()
      .WithImage("mcr.microsoft.com/azure-storage/azurite:latest")
      .Build();

    await _azurite.StartAsync();

    _client = new ServiceBusClient(_azurite.GetConnectionString());
  }

  [Test]
  public async Task HandleAsync_PublishesToServiceBus_MessageReceived() {
    // Arrange
    var sender = _client.CreateSender("orders");
    var receiver = _client.CreateReceiver("orders");

    var @event = new OrderCreated {
      OrderId = "order-123",
      CustomerId = "cust-456",
      TotalAmount = 99.99m
    };

    // Act
    await sender.SendMessageAsync(new ServiceBusMessage(
      JsonSerializer.SerializeToUtf8Bytes(@event)
    ));

    // Assert
    var message = await receiver.ReceiveMessageAsync(TimeSpan.FromSeconds(5));
    await Assert.That(message).IsNotNull();

    var received = JsonSerializer.Deserialize<OrderCreated>(message.Body.ToArray());
    await Assert.That(received.OrderId).IsEqualTo("order-123");
  }

  public async Task DisposeAsync() {
    await _client.DisposeAsync();
    await _azurite.DisposeAsync();
  }
}
```

---

## Parameterized Tests

**TUnit supports parameterized tests**:

```csharp
public class OrderValidationTests {
  [Test]
  [Arguments(0, "Quantity must be greater than zero")]
  [Arguments(-1, "Quantity must be greater than zero")]
  [Arguments(-100, "Quantity must be greater than zero")]
  public async Task HandleAsync_InvalidQuantity_ThrowsValidationException(
    int quantity,
    string expectedMessage
  ) {
    // Arrange
    var command = new CreateOrder {
      CustomerId = "cust-123",
      Items = [
        new OrderItem { ProductId = "prod-456", Quantity = quantity, UnitPrice = 19.99m }
      ]
    };

    var receptor = new CreateOrderReceptor(Mock.Of<IDbConnection>());

    // Act & Assert
    await Assert.That(() => receptor.HandleAsync(command))
      .ThrowsExactly<ValidationException>()
      .WithMessage(expectedMessage);
  }

  [Test]
  [Arguments("")]
  [Arguments(" ")]
  [Arguments(null)]
  public async Task HandleAsync_InvalidCustomerId_ThrowsValidationException(string customerId) {
    // Arrange
    var command = new CreateOrder {
      CustomerId = customerId,
      Items = [
        new OrderItem { ProductId = "prod-456", Quantity = 1, UnitPrice = 19.99m }
      ]
    };

    var receptor = new CreateOrderReceptor(Mock.Of<IDbConnection>());

    // Act & Assert
    await Assert.That(() => receptor.HandleAsync(command))
      .ThrowsExactly<ValidationException>()
      .WithMessage("Customer ID is required");
  }
}
```

---

## Async Testing Best Practices

### 1. Use `await` in Assertions

```csharp
// ✅ GOOD - Await TUnit assertions
await Assert.That(result).IsNotNull();
await Assert.That(result.OrderId).IsEqualTo("order-123");

// ❌ BAD - Don't forget await
Assert.That(result).IsNotNull();  // Won't work in TUnit
```

### 2. Test Cancellation

```csharp
[Test]
public async Task HandleAsync_CancellationRequested_ThrowsOperationCanceledException() {
  // Arrange
  var cts = new CancellationTokenSource();
  cts.Cancel();

  var receptor = new CreateOrderReceptor(Mock.Of<IDbConnection>());
  var command = OrderTestData.CreateValidOrder();

  // Act & Assert
  await Assert.That(() => receptor.HandleAsync(command, cts.Token))
    .ThrowsExactly<OperationCanceledException>();
}
```

### 3. Test Timeout

```csharp
[Test]
[Timeout(5000)]  // 5 seconds max
public async Task HandleAsync_SlowOperation_CompletesWithinTimeout() {
  // Arrange
  var receptor = new CreateOrderReceptor(Mock.Of<IDbConnection>());
  var command = OrderTestData.CreateValidOrder();

  // Act
  var result = await receptor.HandleAsync(command);

  // Assert
  await Assert.That(result).IsNotNull();
}
```

---

## Testing Policies

**Testing custom policies**:

**PolicyTests.cs**:

```csharp
public class TenantIsolationPolicyTests {
  [Test]
  public async Task ApplyAsync_DifferentTenant_ThrowsUnauthorizedException() {
    // Arrange
    var context = new PolicyContext {
      Message = new CreateOrder { CustomerId = "cust-123" },
      Envelope = new MessageEnvelope {
        Headers = new Dictionary<string, string> {
          ["tenant-id"] = "tenant-A"
        }
      }
    };

    var policy = new TenantIsolationPolicy();

    // Assume current tenant is "tenant-B"
    TenantContext.CurrentTenantId = "tenant-B";

    // Act & Assert
    await Assert.That(() => policy.ApplyAsync(context))
      .ThrowsExactly<UnauthorizedException>()
      .WithMessage("Tenant mismatch");
  }

  [Test]
  public async Task ApplyAsync_SameTenant_Succeeds() {
    // Arrange
    var context = new PolicyContext {
      Message = new CreateOrder { CustomerId = "cust-123" },
      Envelope = new MessageEnvelope {
        Headers = new Dictionary<string, string> {
          ["tenant-id"] = "tenant-A"
        }
      }
    };

    var policy = new TenantIsolationPolicy();
    TenantContext.CurrentTenantId = "tenant-A";

    // Act
    await policy.ApplyAsync(context);

    // Assert - No exception thrown
  }
}
```

---

## Code Coverage

**Measure code coverage**:

```bash
dotnet test --collect:"XPlat Code Coverage"
```

**Generate HTML report**:

```bash
dotnet tool install -g dotnet-reportgenerator-globaltool

reportgenerator \
  -reports:"**/coverage.cobertura.xml" \
  -targetdir:"coverage-report" \
  -reporttypes:Html

open coverage-report/index.html
```

**Target coverage**:
- **Receptors**: 100% (critical business logic)
- **Perspectives**: 100% (data consistency)
- **Policies**: 100% (security/validation)
- **Infrastructure**: 80%+ (lower priority)

---

## Key Takeaways

✅ **TUnit** - Modern source-generation test framework
✅ **Rocks** - AOT-compatible mocking with source generators
✅ **Bogus** - Generate realistic test data
✅ **Testcontainers** - Docker-based integration tests
✅ **100% Coverage** - All receptors, perspectives, policies
✅ **Parameterized Tests** - Test multiple scenarios efficiently
✅ **Async Testing** - Proper async/await patterns

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
