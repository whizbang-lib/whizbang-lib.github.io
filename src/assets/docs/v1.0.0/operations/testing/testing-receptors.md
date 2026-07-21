---
title: Testing Receptors & Perspectives
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Advanced Topics
order: 2
description: >-
  Unit testing patterns for receptors and perspectives - mocking, fixtures, and
  test strategies
tags: 'testing, unit-tests, mocking, tunit, rocks, fixtures'
codeReferences:
  - src/Whizbang.Core/IReceptor.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
  - src/Whizbang.Core/Policies/PolicyContext.cs
  - src/Whizbang.Core/Policies/IPolicyEngine.cs
  - src/Whizbang.Testing/Lifecycle/PerspectiveCompletionWaiter.cs
  - src/Whizbang.Testing/Lifecycle/LifecycleStageAwaiter.cs
  - samples/ECommerce/ECommerce.OrderService.API/Receptors/CreateOrderReceptor.cs
  - samples/ECommerce/ECommerce.InventoryWorker/Perspectives/ProductCatalogPerspective.cs
testReferences:
  - tests/Whizbang.Core.Tests/Receptors/ReceptorTests.cs
  - tests/Whizbang.Core.Tests/Receptors/VoidReceptorTests.cs
  - tests/Whizbang.Policies.Tests/PolicyEngineTests.cs
  - samples/ECommerce/tests/ECommerce.OrderService.Tests/CreateOrderReceptorTests.cs
lastMaintainedCommit: '01f07906'
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

```xml{title="Testing Stack" description="Test packages used by the Whizbang repository" category="Best-Practices" difficulty="BEGINNER" tags=["Operations", "Testing", "Xml", "Stack"]}
<ItemGroup>
  <PackageReference Include="TUnit" Version="1.12.125" />
  <PackageReference Include="TUnit.Assertions" Version="1.12.125" />
  <PackageReference Include="Rocks" Version="10.0.0" />
  <PackageReference Include="Bogus" Version="35.6.5" />
  <PackageReference Include="Testcontainers.PostgreSql" Version="4.10.0" />
</ItemGroup>
```

**Why these tools?**:
- **TUnit** - Modern source-generation test framework (faster than xUnit)
- **TUnit.Assertions** - Fluent, awaitable assertions native to TUnit
- **Rocks** - Source-generation mocking (AOT-compatible, faster than Moq)
- **Bogus** - Test data generation
- **Testcontainers** - Docker-based integration tests

---

## Unit Testing Receptors

Receptors implement `IReceptor<TMessage>` (side effects only) or `IReceptor<TMessage, TResponse>` (returns an event). Both expose a single `HandleAsync` method, so unit tests construct the receptor directly with test doubles for its dependencies.

### Basic Receptor Test

The `CreateOrderReceptor` sample takes an `IDispatcher` and an `ILogger<T>`. Wide framework interfaces like `IDispatcher` are easiest to stub with a small hand-rolled fake that records calls; loggers use `NullLogger<T>.Instance`:

```csharp{title="Basic Receptor Test" description="Unit test for CreateOrderReceptor using a recording dispatcher fake" category="Best-Practices" difficulty="ADVANCED" tags=["Operations", "Testing", "Basic", "Receptor"] unverified="sample receptor test — exercised by CreateOrderReceptorTests, which is outside the current coverage map"}
using Microsoft.Extensions.Logging.Abstractions;
using TUnit.Assertions;
using TUnit.Core;

public class CreateOrderReceptorTests {
  [Test]
  public async Task HandleAsync_ValidOrder_ReturnsOrderCreatedAsync() {
    // Arrange
    var dispatcher = new TestDispatcher();  // records PublishAsync calls
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
    await Assert.That(result).IsNotNull();
    await Assert.That(result.OrderId).IsEqualTo(command.OrderId);
    await Assert.That(result.CustomerId).IsEqualTo(command.CustomerId);
    await Assert.That(result.TotalAmount).IsEqualTo(39.98m);

    // Verify the event was published
    await Assert.That(dispatcher.PublishCount).IsEqualTo(1);
    await Assert.That(dispatcher.PublishedMessages[0]).IsTypeOf<OrderCreatedEvent>();
  }

  [Test]
  public async Task HandleAsync_EmptyOrder_ThrowsInvalidOperationExceptionAsync() {
    // Arrange
    var receptor = new CreateOrderReceptor(
      new TestDispatcher(),
      NullLogger<CreateOrderReceptor>.Instance);

    var command = new CreateOrderCommand {
      OrderId = OrderId.New(),
      CustomerId = CustomerId.New(),
      LineItems = [],  // Empty items
      TotalAmount = 39.98m
    };

    // Act & Assert
    await Assert.That(async () => await receptor.HandleAsync(command))
      .Throws<InvalidOperationException>()
      .WithMessage("Order must contain at least one item");
  }
}
```

The `TestDispatcher` fake implements `IDispatcher`, adds published events to a `PublishedMessages` list, and throws `NotImplementedException` from members the test never touches. See `samples/ECommerce/tests/ECommerce.OrderService.Tests/CreateOrderReceptorTests.cs` for the full implementation.

---

## Mocking with Rocks

**Rocks** generates mocks at compile-time using source generators (AOT-compatible, zero reflection). Declare which types to mock with an assembly-level attribute; Rocks emits a `<TypeName>CreateExpectations` class:

```csharp{title="Mocking with Rocks" description="Compile-time mock generation for a narrow app interface" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Operations", "Testing", "Rocks", "Mocking"] unverified="mock/DI-wiring demonstration (Rocks source-generated expectations) — no in-map verifier"}
using Rocks;

// Assembly-level: tells the Rocks source generator to build a mock for this type
[assembly: Rock(typeof(IPaymentGateway), BuildType.Create)]

public class ProcessPaymentReceptorTests {
  [Test]
  public async Task HandleAsync_GatewayApproves_PublishesPaymentProcessedAsync() {
    // Arrange - configure the generated expectations class
    var gatewayExpectations = new IPaymentGatewayCreateExpectations();
    gatewayExpectations.Methods
      .ChargeAsync(Arg.Any<decimal>(), Arg.Any<CancellationToken>())
      .ReturnValue(Task.FromResult(PaymentResult.Approved));

    var dispatcher = new TestDispatcher();
    var receptor = new ProcessPaymentReceptor(gatewayExpectations.Instance(), dispatcher);

    // Act
    await receptor.HandleAsync(new ProcessPaymentCommand {
      OrderId = OrderId.New(),
      Amount = 99.99m
    });

    // Assert
    await Assert.That(dispatcher.PublishedMessages[0]).IsTypeOf<PaymentProcessedEvent>();

    // Verify all configured expectations were met
    gatewayExpectations.Verify();
  }

  [Test]
  public async Task HandleAsync_GatewayThrows_PropagatesExceptionAsync() {
    // Arrange
    var gatewayExpectations = new IPaymentGatewayCreateExpectations();
    gatewayExpectations.Methods
      .ChargeAsync(Arg.Any<decimal>(), Arg.Any<CancellationToken>())
      .Callback((_, _) => throw new InvalidOperationException("Gateway unavailable"));

    var receptor = new ProcessPaymentReceptor(gatewayExpectations.Instance(), new TestDispatcher());

    // Act & Assert
    await Assert.That(async () => await receptor.HandleAsync(
        new ProcessPaymentCommand { OrderId = OrderId.New(), Amount = 99.99m }))
      .Throws<InvalidOperationException>();
  }
}
```

**Guideline**: use Rocks for **narrow interfaces you own** (gateways, repositories, clocks). For wide framework interfaces like `IDispatcher`, a hand-rolled recording fake is simpler and is the pattern used throughout the Whizbang test suite.

---

## Test Data Generation with Bogus

**OrderTestData.cs**:

```csharp{title="Test Data Generation with Bogus" description="Reusable Bogus-based factory for order commands" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Operations", "Testing", "Test", "Data"] unverified="Bogus test-data factory — fixture setup, not a behavior under test"}
using Bogus;

public static class OrderTestData {
  private static readonly Faker Faker = new();

  public static CreateOrderCommand CreateValidOrder(int itemCount = 1) {
    var items = Enumerable.Range(0, itemCount)
      .Select(_ => new OrderLineItem {
        ProductId = ProductId.New(),
        ProductName = Faker.Commerce.ProductName(),
        Quantity = Faker.Random.Int(1, 10),
        UnitPrice = Faker.Finance.Amount(10, 100)
      })
      .ToList();

    return new CreateOrderCommand {
      OrderId = OrderId.New(),
      CustomerId = CustomerId.New(),
      LineItems = items,
      TotalAmount = items.Sum(i => i.Quantity * i.UnitPrice)
    };
  }
}
```

:::updated
Use your contract's strongly-typed IDs (`OrderId.New()`, `ProductId.New()`, ...) in test data. If you need a raw `Guid` for a Whizbang identifier, use `TrackedGuid.NewMedo()` (UUIDv7, from `Whizbang.Core.ValueObjects`) instead of `Guid.NewGuid()` - Whizbang enforces UUIDv7 for stream and message IDs.
:::

**Usage**:

```csharp{title="Test Data Generation with Bogus (2)" description="Using the Bogus factory in a receptor test" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Operations", "Testing", "Test", "Data"] tests=["ReceptorTests.Receive_CalculatesTotal_ShouldSumItemPricesAsync"]}
[Test]
public async Task HandleAsync_MultipleItems_CalculatesTotalCorrectlyAsync() {
  // Arrange
  var command = OrderTestData.CreateValidOrder(itemCount: 5);
  var expectedTotal = command.LineItems.Sum(i => i.Quantity * i.UnitPrice);

  var receptor = new CreateOrderReceptor(
    new TestDispatcher(),
    NullLogger<CreateOrderReceptor>.Instance);

  // Act
  var result = await receptor.HandleAsync(command);

  // Assert
  await Assert.That(result.TotalAmount).IsEqualTo(expectedTotal);
}
```

---

## Unit Testing Perspectives

Whizbang perspectives are **pure functions**: they implement `IPerspectiveFor<TData, TEvent...>` with `Apply(currentData, @event)` overloads that take the current perspective row and an event, and return the new row. No I/O, no mocks - the framework's `PerspectiveRunner` handles all persistence.

**ProductCatalogPerspectiveTests.cs**:

```csharp{title="Basic Perspective Test" description="Testing pure Apply functions - no mocking required" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Operations", "Testing", "Basic", "Perspective"] unverified="sample perspective Apply test (ProductCatalogPerspective) — no in-map perspective verifier in the current coverage map"}
public class ProductCatalogPerspectiveTests {
  [Test]
  public async Task Apply_ProductCreatedEvent_CreatesProductAsync() {
    // Arrange
    var perspective = new ProductCatalogPerspective();
    var @event = new ProductCreatedEvent {
      ProductId = ProductId.New(),
      Name = "Widget",
      Description = "A useful widget",
      Price = 9.99m,
      CreatedAt = DateTime.UtcNow
    };

    // Act - pure function: current data in, new data out
    var result = perspective.Apply(null!, @event);

    // Assert
    await Assert.That(result.ProductId).IsEqualTo(@event.ProductId);
    await Assert.That(result.Name).IsEqualTo("Widget");
    await Assert.That(result.Price).IsEqualTo(9.99m);
    await Assert.That(result.DeletedAt).IsNull();
  }

  [Test]
  public async Task Apply_ProductUpdatedEvent_AppliesPartialUpdateAsync() {
    // Arrange
    var perspective = new ProductCatalogPerspective();
    var current = new ProductDto {
      ProductId = ProductId.New(),
      Name = "Widget",
      Price = 9.99m,
      CreatedAt = DateTime.UtcNow.AddDays(-1)
    };

    var @event = new ProductUpdatedEvent {
      ProductId = current.ProductId,
      Price = 12.99m,          // Only price changes
      Name = null,             // Null = keep current value
      UpdatedAt = DateTime.UtcNow
    };

    // Act
    var result = perspective.Apply(current, @event);

    // Assert - partial update semantics
    await Assert.That(result.Price).IsEqualTo(12.99m);
    await Assert.That(result.Name).IsEqualTo("Widget");  // Unchanged
    await Assert.That(result.UpdatedAt).IsEqualTo(@event.UpdatedAt);
  }

  [Test]
  public async Task Apply_ProductDeletedEvent_SoftDeletesAsync() {
    // Arrange
    var perspective = new ProductCatalogPerspective();
    var current = new ProductDto { ProductId = ProductId.New(), Name = "Widget" };
    var deletedAt = DateTime.UtcNow;

    // Act
    var result = perspective.Apply(current, new ProductDeletedEvent {
      ProductId = current.ProductId,
      DeletedAt = deletedAt
    });

    // Assert - soft delete preserves the record
    await Assert.That(result.DeletedAt).IsEqualTo(deletedAt);
    await Assert.That(result.Name).IsEqualTo("Widget");
  }
}
```

**Because `Apply` is pure, perspective unit tests need zero infrastructure** - no database, no mocks, no fixtures. Persistence behavior (upserts, checkpoints) is covered by the framework's own tests; end-to-end materialization is covered by integration tests with [lifecycle synchronization](./lifecycle-synchronization).

---

## Test Fixtures

TUnit uses `[Before(...)]` / `[After(...)]` hooks instead of xUnit's `IAsyncLifetime` / `IClassFixture`:

```csharp{title="Test Fixtures" description="TUnit per-test database setup and teardown" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Operations", "Testing", "Test", "Fixtures"] unverified="TUnit Before/After fixture setup — no behavior under test"}
public class CreateOrderReceptorIntegrationTests {
  private NpgsqlConnection _connection = null!;

  [Before(Test)]
  public async Task SetupAsync() {
    _connection = new NpgsqlConnection("Host=localhost;Database=test_db;");
    await _connection.OpenAsync();

    await using var cmd = _connection.CreateCommand();
    cmd.CommandText = """
      CREATE TABLE IF NOT EXISTS orders (
        order_id UUID PRIMARY KEY,
        customer_id UUID NOT NULL,
        total_amount DECIMAL(18,2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
      """;
    await cmd.ExecuteNonQueryAsync();
  }

  [After(Test)]
  public async Task CleanupAsync() {
    await using var cmd = _connection.CreateCommand();
    cmd.CommandText = "DROP TABLE IF EXISTS orders";
    await cmd.ExecuteNonQueryAsync();
    await _connection.DisposeAsync();
  }

  [Test]
  public async Task HandleAsync_WithRealDatabase_InsertsOrderAsync() {
    // ... test body uses _connection ...
  }
}
```

Use `[Before(Class)]` / `[After(Class)]` (static methods) for expensive resources shared by all tests in a class, and share containers across classes via a static helper (see the `SharedIntegrationFixture` pattern in the ECommerce sample tests).

---

## Integration Testing with Testcontainers

**PostgreSQL Container**:

```csharp{title="Integration Testing with Testcontainers" description="PostgreSQL container with TUnit lifecycle hooks" category="Best-Practices" difficulty="ADVANCED" tags=["Operations", "Testing", "C#", "Integration", "Testcontainers"] unverified="Testcontainers PostgreSQL fixture wiring — no behavior under test"}
using Testcontainers.PostgreSql;

public class PostgresIntegrationTests {
  private PostgreSqlContainer _postgres = null!;
  private NpgsqlConnection _connection = null!;

  [Before(Test)]
  public async Task SetupAsync() {
    _postgres = new PostgreSqlBuilder()
      .WithImage("postgres:16")
      .WithDatabase("test_db")
      .WithUsername("postgres")
      .WithPassword("postgres")
      .Build();

    await _postgres.StartAsync();

    _connection = new NpgsqlConnection(_postgres.GetConnectionString());
    await _connection.OpenAsync();
  }

  [After(Test)]
  public async Task TeardownAsync() {
    await _connection.DisposeAsync();
    await _postgres.DisposeAsync();
  }

  [Test]
  public async Task HandleAsync_WithPostgres_FullIntegrationAsync() {
    // ... exercise receptor + query rows through _connection ...
  }
}
```

**Azure Service Bus Emulator Container**:

```csharp{title="Integration Testing with Testcontainers - Service Bus" description="Azure Service Bus emulator container (Testcontainers.ServiceBus)" category="Best-Practices" difficulty="ADVANCED" tags=["Operations", "Testing", "C#", "Integration", "Testcontainers"] unverified="Testcontainers Service Bus emulator fixture wiring — no behavior under test"}
using Testcontainers.ServiceBus;

public class ServiceBusIntegrationTests {
  private ServiceBusContainer _serviceBus = null!;
  private ServiceBusClient _client = null!;

  [Before(Test)]
  public async Task SetupAsync() {
    _serviceBus = new ServiceBusBuilder("mcr.microsoft.com/azure-messaging/servicebus-emulator:latest")
      .WithAcceptLicenseAgreement(true)
      .Build();

    await _serviceBus.StartAsync();

    _client = new ServiceBusClient(_serviceBus.GetConnectionString());
  }

  [After(Test)]
  public async Task TeardownAsync() {
    await _client.DisposeAsync();
    await _serviceBus.DisposeAsync();
  }

  // ... tests drive Whizbang hosts wired to _serviceBus.GetConnectionString() ...
}
```

:::updated
The Azure Service Bus emulator (`mcr.microsoft.com/azure-messaging/servicebus-emulator`) is the container Whizbang's own Azure Service Bus integration tests use - not Azurite, which emulates Azure *Storage*, not Service Bus. Queues/topics for the emulator are declared via `ServiceBusBuilder`'s config API.
:::

**Synchronization**: when asserting on perspective data after dispatching through a real transport, never poll - use the completion-signal helpers from `Whizbang.Testing` (`LifecycleAwaiter`, `PerspectiveCompletionWaiter<TEvent>`). See [Lifecycle Synchronization](./lifecycle-synchronization).

---

## Parameterized Tests

**TUnit supports parameterized tests** via `[Arguments]`:

```csharp{title="Parameterized Tests" description="TUnit [Arguments] attribute for multiple scenarios" category="Best-Practices" difficulty="ADVANCED" tags=["Operations", "Testing", "Parameterized", "Tests"] unverified="TUnit [Arguments] feature demo; asserts sample CreateOrderReceptor total validation, exercised by CreateOrderReceptorTests, which is outside the current coverage map"}
public class OrderValidationTests {
  [Test]
  [Arguments(-10.00)]
  [Arguments(0.00)]
  public async Task HandleAsync_NonPositiveTotal_ThrowsInvalidOperationExceptionAsync(double totalAmount) {
    // Arrange
    var command = new CreateOrderCommand {
      OrderId = OrderId.New(),
      CustomerId = CustomerId.New(),
      LineItems = [
        new OrderLineItem {
          ProductId = ProductId.New(),
          ProductName = "Widget",
          Quantity = 1,
          UnitPrice = 19.99m
        }
      ],
      TotalAmount = (decimal)totalAmount
    };

    var receptor = new CreateOrderReceptor(
      new TestDispatcher(),
      NullLogger<CreateOrderReceptor>.Instance);

    // Act & Assert
    await Assert.That(async () => await receptor.HandleAsync(command))
      .Throws<InvalidOperationException>()
      .WithMessage("Order total must be positive");
  }
}
```

---

## Async Testing Best Practices

### 1. Use `await` in Assertions

```csharp{title="Use `await` in Assertions" description="TUnit assertions are awaitable and must be awaited" category="Best-Practices" difficulty="BEGINNER" tags=["Operations", "Testing", "Await", "Assertions"] unverified="conceptual await-usage snippet with counter-example — no behavior under test"}
// ✅ GOOD - Await TUnit assertions
await Assert.That(result).IsNotNull();
await Assert.That(result.OrderId).IsEqualTo(command.OrderId);

// ❌ BAD - Don't forget await
Assert.That(result).IsNotNull();  // Won't execute in TUnit
```

### 2. Test Cancellation

```csharp{title="Test Cancellation" description="Verify receptors respect CancellationToken" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Operations", "Testing", "Test", "Cancellation"] tests=["VoidReceptorTests.VoidReceptor_CancellationToken_ShouldRespectCancellationAsync"]}
[Test]
public async Task HandleAsync_CancellationRequested_ThrowsOperationCanceledExceptionAsync() {
  // Arrange
  using var cts = new CancellationTokenSource();
  await cts.CancelAsync();

  var receptor = new ProcessPaymentReceptor(/* deps that honor the token */);
  var command = OrderTestData.CreateValidOrder();

  // Act & Assert
  await Assert.That(async () => await receptor.HandleAsync(command, cts.Token))
    .Throws<OperationCanceledException>();
}
```

### 3. Test Timeout

```csharp{title="Test Timeout" description="TUnit Timeout attribute bounds test runtime" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Operations", "Testing", "Test", "Timeout"] unverified="TUnit [Timeout] attribute demonstration — framework feature, not a receptor behavior under test"}
[Test]
[Timeout(5000)]  // 5 seconds max
public async Task HandleAsync_SlowOperation_CompletesWithinTimeoutAsync() {
  // Arrange
  var receptor = new CreateOrderReceptor(
    new TestDispatcher(),
    NullLogger<CreateOrderReceptor>.Instance);
  var command = OrderTestData.CreateValidOrder();

  // Act
  var result = await receptor.HandleAsync(command);

  // Assert
  await Assert.That(result).IsNotNull();
}
```

**Never use `Task.Delay` or polling loops to wait for asynchronous processing** - use completion signals (`TaskCompletionSource`, the `Whizbang.Testing` awaiters, or first-class API hooks). Timing-based waits are the number-one source of flaky tests.

---

## Testing Policies

Policies are registered on the `IPolicyEngine` as a name + predicate + configuration. Test them by constructing a `PolicyContext` and calling `MatchAsync`:

```csharp{title="Testing Policies" description="PolicyEngine matching tests with PolicyContext" category="Best-Practices" difficulty="ADVANCED" tags=["Operations", "Testing", "C#", "Policies"] tests=["PolicyEngineTests.PolicyEngine_ShouldMatchSinglePolicyAsync", "PolicyEngineTests.PolicyEngine_ShouldReturnNullWhenNoPolicyMatchesAsync", "PolicyEngineTests.PolicyEngine_ShouldRecordUnmatchedPoliciesInTrailAsync"]}
using Whizbang.Core.Policies;

public class OrderPolicyTests {
  [Test]
  public async Task MatchAsync_OrderCommand_RoutesToOrdersTopicAsync() {
    // Arrange
    var engine = new PolicyEngine();
    engine.AddPolicy(
      "OrderPolicy",
      ctx => ctx.Message is CreateOrderCommand,
      config => config.UseTopic("orders"));

    var command = OrderTestData.CreateValidOrder();
    var context = new PolicyContext(command, envelope: null, services: null, environment: "test");

    // Act
    var policyConfig = await engine.MatchAsync(context);

    // Assert
    await Assert.That(policyConfig).IsNotNull();
    await Assert.That(policyConfig!.Topic).IsEqualTo("orders");
  }

  [Test]
  public async Task MatchAsync_UnmatchedMessage_ReturnsNullAndRecordsTrailAsync() {
    // Arrange
    var engine = new PolicyEngine();
    engine.AddPolicy(
      "OrderPolicy",
      ctx => ctx.Message is CreateOrderCommand,
      config => config.UseTopic("orders"));

    var context = new PolicyContext(new ProcessPaymentCommand {
      OrderId = OrderId.New(),
      Amount = 10m
    }, environment: "test");

    // Act
    var policyConfig = await engine.MatchAsync(context);

    // Assert - no match, but every evaluation is recorded in the decision trail
    await Assert.That(policyConfig).IsNull();
    await Assert.That(context.Trail.Decisions).IsNotEmpty();
  }
}
```

`PolicyContext` is constructed through its constructor (`message`, optional `envelope`, `services`, `environment`) - its properties are read-only. Helpers like `HasTag`, `GetMetadata`, and `MatchesAggregate<T>` are available for predicate logic.

---

## Code Coverage

**Measure code coverage**:

```bash{title="Code Coverage" description="Measure code coverage:" category="Best-Practices" difficulty="BEGINNER" tags=["Operations", "Testing", "Code", "Coverage"]}
dotnet test --collect:"XPlat Code Coverage"
```

**Generate HTML report**:

```bash{title="Code Coverage (2)" description="Generate HTML report:" category="Best-Practices" difficulty="BEGINNER" tags=["Operations", "Testing", "Code", "Coverage"]}
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

✅ **TUnit** - Modern source-generation test framework; assertions are awaited
✅ **Rocks** - AOT-compatible mocking via `[assembly: Rock(...)]` + generated expectations
✅ **Hand-rolled fakes** - Simpler than mocks for wide interfaces like `IDispatcher`
✅ **Pure perspectives** - `Apply(currentData, @event)` tests need zero infrastructure
✅ **Bogus** - Generate realistic test data with strongly-typed IDs
✅ **Testcontainers** - PostgreSQL + Service Bus emulator for integration tests
✅ **Completion signals, never polling** - `Whizbang.Testing` awaiters for async waits
✅ **100% Coverage** - All receptors, perspectives, policies

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
