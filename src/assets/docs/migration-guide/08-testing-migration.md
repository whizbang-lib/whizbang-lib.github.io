# Testing Migration

This guide covers migrating tests from Marten/Wolverine testing patterns to Whizbang.

## Overview

| Marten/Wolverine | Whizbang |
|------------------|----------|
| `DocumentStore.CreateCleanStore()` | `WhizbangTestFixture` |
| `WolverineOptions.Testing()` | `WhizbangTestContext` |
| `ITestOutputHelper` | Built-in test logging |
| Custom test hosts | `WhizbangTestHost` |

## Test Fixture Setup

### Before: Marten/Wolverine

```csharp
public class OrderTests : IAsyncLifetime {
  private IHost _host;
  private IDocumentStore _store;

  public async Task InitializeAsync() {
    _host = await Host.CreateDefaultBuilder()
      .UseWolverine(opts => {
        opts.Services.AddMarten(m => {
          m.Connection(TestConnectionString);
          m.AutoCreateSchemaObjects = AutoCreate.All;
        });
      })
      .StartAsync();

    _store = _host.Services.GetRequiredService<IDocumentStore>();
    await _store.Advanced.Clean.DeleteAllDocumentsAsync();
  }

  public async Task DisposeAsync() {
    await _host.StopAsync();
    _host.Dispose();
  }
}
```

### After: Whizbang

```csharp
public class OrderTests : WhizbangTestFixture {
  public OrderTests(ITestOutputHelper output) : base(output) { }

  protected override void ConfigureServices(IServiceCollection services) {
    // Add test-specific services
    services.AddSingleton<IPaymentGateway, MockPaymentGateway>();
  }

  [Test]
  public async Task CreateOrder_AppendsEventToStore() {
    // Test implementation using TestContext
  }
}
```

## Testing Receptors

### Before: Wolverine Handler Test

```csharp
[Fact]
public async Task CreateOrder_StoresOrderInDatabase() {
  // Arrange
  var handler = new CreateOrderHandler(_session);
  var command = new CreateOrderCommand(Guid.NewGuid(), [new Item("Product1", 2)]);

  // Act
  await handler.Handle(command);

  // Assert
  var order = await _session.Query<Order>()
    .SingleOrDefaultAsync(o => o.CustomerId == command.CustomerId);
  Assert.NotNull(order);
}
```

### After: Whizbang Receptor Test

```csharp
[Test]
public async Task CreateOrder_AppendsEventToStoreAsync() {
  // Arrange
  var receptor = TestContext.GetService<CreateOrderReceptor>();
  var command = new CreateOrderCommand(Guid.NewGuid(), [new Item("Product1", 2)]);

  // Act
  var result = await receptor.HandleAsync(command, CancellationToken.None);

  // Assert
  var events = await TestContext.EventStore
    .ReadAsync<OrderCreated>(result.OrderId, 0)
    .ToListAsync();

  await Assert.That(events).HasCount().EqualTo(1);
  await Assert.That(events[0].Payload.CustomerId).IsEqualTo(command.CustomerId);
}
```

## Testing Perspectives

### Before: Marten Projection Test

```csharp
[Fact]
public async Task OrderProjection_CreatesViewOnOrderCreated() {
  // Arrange
  var orderId = Guid.NewGuid();
  var @event = new OrderCreated(orderId, Guid.NewGuid(), []);

  // Act
  using var session = _store.LightweightSession();
  session.Events.StartStream<Order>(orderId, @event);
  await session.SaveChangesAsync();

  // Force projection to run
  await _store.WaitForNonStaleProjectionDataAsync(TimeSpan.FromSeconds(5));

  // Assert
  var view = await session.LoadAsync<OrderView>(orderId);
  Assert.NotNull(view);
  Assert.Equal(OrderStatus.Created, view.Status);
}
```

### After: Whizbang Perspective Test

```csharp
[Test]
public async Task OrderPerspective_CreatesViewOnOrderCreatedAsync() {
  // Arrange
  var perspective = new OrderPerspective();
  var orderId = Guid.NewGuid();
  var @event = new OrderCreated(orderId, Guid.NewGuid(), []);

  // Act - perspectives are pure functions, easy to test
  var view = perspective.Apply(null, @event);

  // Assert
  await Assert.That(view.Id).IsEqualTo(orderId);
  await Assert.That(view.Status).IsEqualTo(OrderStatus.Created);
}

[Test]
public async Task OrderPerspective_IntegrationTestAsync() {
  // Full integration test with event store
  var orderId = Guid.NewGuid();
  var createEvent = new OrderCreated(orderId, Guid.NewGuid(), []);
  var shipEvent = new OrderShipped(orderId, DateTimeOffset.UtcNow);

  await TestContext.EventStore.AppendAsync(orderId, createEvent);
  await TestContext.EventStore.AppendAsync(orderId, shipEvent);

  // Get projected view
  var view = await TestContext.Perspectives.GetAsync<OrderView>(orderId);

  await Assert.That(view).IsNotNull();
  await Assert.That(view!.Status).IsEqualTo(OrderStatus.Shipped);
}
```

## Testing Dispatchers

### Before: Wolverine Message Testing

```csharp
[Fact]
public async Task CreateOrder_PublishesOrderCreatedEvent() {
  // Arrange
  var recorder = new MessageRecorder();
  var handler = new CreateOrderHandler(_session, recorder);

  // Act
  await handler.Handle(new CreateOrderCommand(...));

  // Assert
  Assert.Single(recorder.Published.OfType<OrderCreated>());
}
```

### After: Whizbang Dispatcher Testing

```csharp
[Test]
public async Task CreateOrder_PublishesOrderCreatedEventAsync() {
  // Arrange
  var receptor = TestContext.GetService<CreateOrderReceptor>();

  // Act
  await receptor.HandleAsync(new CreateOrderCommand(...), CancellationToken.None);

  // Assert - check dispatched messages
  var published = TestContext.Dispatcher.PublishedMessages;
  await Assert.That(published.OfType<OrderCreated>()).HasCount().EqualTo(1);
}
```

## Test Doubles

### Mock Event Store

```csharp
[Test]
public async Task Receptor_HandlesEventStoreFailureAsync() {
  // Arrange
  var mockEventStore = TestContext.GetMock<IEventStore>();
  mockEventStore.AppendAsync(Arg.Any<Guid>(), Arg.Any<object>(), Arg.Any<CancellationToken>())
    .ThrowsAsync(new EventStoreException("Connection failed"));

  var receptor = new CreateOrderReceptor(mockEventStore, TestContext.Dispatcher);

  // Act & Assert
  await Assert.ThrowsAsync<EventStoreException>(
    async () => await receptor.HandleAsync(new CreateOrderCommand(...), CancellationToken.None));
}
```

### In-Memory Transport

```csharp
public class IntegrationTests : WhizbangTestFixture {
  protected override void ConfigureTransport(ITransportConfiguration transport) {
    transport.UseInMemory(); // Messages processed synchronously
  }

  [Test]
  public async Task OrderCreated_TriggersPaymentProcessingAsync() {
    // Publish event
    await TestContext.Dispatcher.PublishAsync(new OrderCreated(...));

    // Verify downstream receptor was invoked
    var paymentCommands = TestContext.Dispatcher.SentMessages
      .OfType<ProcessPaymentCommand>();

    await Assert.That(paymentCommands).HasCount().EqualTo(1);
  }
}
```

## Scenario Testing

### Before: Wolverine Scenario

```csharp
[Fact]
public async Task CompleteOrderWorkflow() {
  await using var host = await WolverineHost.For(opts => {
    opts.Services.AddMarten(...);
    opts.PublishAllMessages().Locally();
  });

  var bus = host.Services.GetRequiredService<IMessageBus>();

  // Execute scenario
  await bus.InvokeAsync(new CreateOrderCommand(...));
  await bus.InvokeAsync(new ProcessPaymentCommand(...));

  // Assert final state
  var session = host.Services.GetRequiredService<IDocumentSession>();
  var order = await session.LoadAsync<Order>(orderId);
  Assert.Equal(OrderStatus.Paid, order.Status);
}
```

### After: Whizbang Scenario

```csharp
[Test]
public async Task CompleteOrderWorkflowAsync() {
  // Create order
  var createResult = await TestContext.Dispatcher
    .LocalInvokeAsync<CreateOrderCommand, OrderCreatedResult>(
      new CreateOrderCommand(customerId, items));

  // Process payment
  await TestContext.Dispatcher
    .LocalInvokeAsync<ProcessPaymentCommand, PaymentResult>(
      new ProcessPaymentCommand(createResult.OrderId, 100m));

  // Assert final state
  var view = await TestContext.Perspectives.GetAsync<OrderView>(createResult.OrderId);
  await Assert.That(view!.Status).IsEqualTo(OrderStatus.Paid);
}
```

## Test Data Builders

### Fluent Test Data

```csharp
public static class TestData {
  public static CreateOrderCommandBuilder CreateOrder() => new();
}

public class CreateOrderCommandBuilder {
  private Guid _customerId = Guid.NewGuid();
  private List<OrderItem> _items = [new("Default", 1, 10m)];

  public CreateOrderCommandBuilder WithCustomer(Guid customerId) {
    _customerId = customerId;
    return this;
  }

  public CreateOrderCommandBuilder WithItems(params OrderItem[] items) {
    _items = items.ToList();
    return this;
  }

  public CreateOrderCommand Build() => new(_customerId, _items);
}

// Usage in tests
[Test]
public async Task CreateOrder_WithMultipleItemsAsync() {
  var command = TestData.CreateOrder()
    .WithItems(
      new OrderItem("Product1", 2, 25m),
      new OrderItem("Product2", 1, 50m))
    .Build();

  var result = await receptor.HandleAsync(command, CancellationToken.None);
  // ...
}
```

## Database Isolation

### Per-Test Schema Isolation

```csharp
public class IsolatedTests : WhizbangTestFixture {
  protected override void ConfigureDatabase(IDatabaseConfiguration db) {
    db.UseSchemaPerTest(); // Each test gets unique schema
    db.CleanupAfterTest = true;
  }

  [Test]
  public async Task Test1Async() {
    // Uses schema: test_isolatedtests_test1async_<guid>
  }

  [Test]
  public async Task Test2Async() {
    // Uses schema: test_isolatedtests_test2async_<guid>
  }
}
```

### Shared Database with Cleanup

```csharp
public class SharedDatabaseTests : WhizbangTestFixture {
  protected override void ConfigureDatabase(IDatabaseConfiguration db) {
    db.UseSharedDatabase();
    db.CleanupBeforeTest = true; // Clean slate for each test
  }
}
```

## Checklist

- [ ] Replace test host setup with `WhizbangTestFixture`
- [ ] Update handler tests to receptor tests
- [ ] Convert projection tests to perspective tests
- [ ] Replace `IMessageBus` assertions with `TestContext.Dispatcher`
- [ ] Use `InMemory` transport for integration tests
- [ ] Create test data builders for complex commands/events
- [ ] Configure database isolation strategy
- [ ] Update mock patterns for new interfaces
- [ ] Verify all async tests end with `Async` suffix

## Next Steps

- [Migration Checklist](./appendix-checklist.md) - Complete migration checklist
