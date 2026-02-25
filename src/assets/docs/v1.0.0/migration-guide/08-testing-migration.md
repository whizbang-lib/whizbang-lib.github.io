---
title: Testing Migration
version: 1.0.0
category: Migration Guide
order: 9
description: Updating test infrastructure when migrating to Whizbang
tags: 'migration, testing, tunit, mocks, integration-tests'
codeReferences:
  - src/Whizbang.Testing/InMemoryEventStore.cs
---

# Testing Migration

This guide covers updating your test infrastructure when migrating from Marten/Wolverine to Whizbang.

## Testing Framework

Whizbang recommends **TUnit** with **Rocks** for AOT-compatible testing:

| Component | Marten/Wolverine Stack | Whizbang Stack |
|-----------|------------------------|----------------|
| Test Framework | xUnit/NUnit | TUnit 1.2.11+ |
| Mocking | Moq/NSubstitute | Rocks 9.3.0+ |
| Data Generation | AutoFixture | Bogus |
| Assertions | FluentAssertions | TUnit.Assertions |

## Package Changes

### Remove

```xml
<PackageReference Include="xunit" />
<PackageReference Include="xunit.runner.visualstudio" />
<PackageReference Include="Moq" />
<PackageReference Include="FluentAssertions" />
```

### Add

```xml
<PackageReference Include="TUnit" Version="1.2.11" />
<PackageReference Include="TUnit.Assertions" Version="1.2.11" />
<PackageReference Include="Rocks" Version="9.3.0" />
<PackageReference Include="Bogus" Version="35.6.1" />
<PackageReference Include="Whizbang.Testing" Version="0.1.0" />
```

## Unit Test Migration

### Handler/Receptor Tests

**xUnit + Moq (before)**:

```csharp
public class OrderHandlerTests {
    [Fact]
    public async Task Handle_ValidOrder_ReturnsOrderCreated() {
        // Arrange
        var mockRepo = new Mock<IOrderRepository>();
        mockRepo.Setup(r => r.CreateAsync(It.IsAny<CreateOrder>()))
            .ReturnsAsync(new Order { Id = Guid.NewGuid() });

        var handler = new OrderHandler(mockRepo.Object);
        var command = new CreateOrder { CustomerId = Guid.NewGuid() };

        // Act
        var result = await handler.HandleAsync(command);

        // Assert
        result.Should().NotBeNull();
        result.OrderId.Should().NotBeEmpty();
        mockRepo.Verify(r => r.CreateAsync(command), Times.Once);
    }
}
```

**TUnit + Rocks (after)**:

```csharp
public class CreateOrderReceptorTests {
    [Test]
    public async Task HandleAsync_ValidOrder_ReturnsOrderCreatedAsync() {
        // Arrange
        var orderId = Guid.CreateVersion7();
        var expectations = Rock.Create<IOrderRepository>();
        expectations.Methods()
            .CreateAsync(Arg.Any<CreateOrder>(), Arg.Any<CancellationToken>())
            .Returns(new Order { Id = orderId });

        var repository = expectations.Instance();
        var receptor = new CreateOrderReceptor(repository);
        var command = new CreateOrder { CustomerId = Guid.CreateVersion7() };

        // Act
        var result = await receptor.HandleAsync(command);

        // Assert
        await Assert.That(result).IsNotNull();
        await Assert.That(result.OrderId).IsEqualTo(orderId);
        expectations.Verify();
    }
}
```

### Perspective Tests

Perspectives are pure functions - no mocks needed!

**TUnit (Whizbang perspective test)**:

```csharp
public class OrderSummaryPerspectiveTests {
    [Test]
    public async Task Apply_OrderCreated_CreatesNewSummaryAsync() {
        // Arrange
        var perspective = new OrderSummaryPerspective();
        var @event = new OrderCreated(
            OrderId: Guid.CreateVersion7(),
            CustomerId: Guid.CreateVersion7(),
            Items: new[] { new OrderItem("SKU1", 2, 29.99m) },
            Timestamp: DateTimeOffset.UtcNow
        );

        // Act
        var result = perspective.Apply(null!, @event);

        // Assert
        await Assert.That(result.Id).IsEqualTo(@event.OrderId);
        await Assert.That(result.Status).IsEqualTo(OrderStatus.Created);
        await Assert.That(result.Total).IsEqualTo(59.98m);
    }

    [Test]
    public async Task Apply_OrderShipped_UpdatesStatusAsync() {
        // Arrange
        var perspective = new OrderSummaryPerspective();
        var current = new OrderSummary {
            Id = Guid.CreateVersion7(),
            Status = OrderStatus.Created,
            Total = 100m
        };
        var @event = new OrderShipped(current.Id, DateTimeOffset.UtcNow);

        // Act
        var result = perspective.Apply(current, @event);

        // Assert
        await Assert.That(result.Status).IsEqualTo(OrderStatus.Shipped);
        await Assert.That(result.ShippedAt).IsNotNull();
        // Verify immutability - original unchanged
        await Assert.That(current.Status).IsEqualTo(OrderStatus.Created);
    }
}
```

## Integration Test Migration

### Marten Test Harness

**Before (Marten)**:

```csharp
public class OrderIntegrationTests : IAsyncLifetime {
    private IDocumentStore _store = null!;

    public async Task InitializeAsync() {
        _store = DocumentStore.For(opts => {
            opts.Connection("Host=localhost;Database=test;...");
            opts.AutoCreateSchemaObjects = AutoCreate.All;
        });
    }

    [Fact]
    public async Task CreateOrder_PersistsEvent() {
        await using var session = _store.LightweightSession();

        var orderId = Guid.NewGuid();
        session.Events.Append(orderId, new OrderCreated(orderId));
        await session.SaveChangesAsync();

        var events = await session.Events.FetchStreamAsync(orderId);
        events.Should().ContainSingle();
    }

    public async Task DisposeAsync() {
        _store.Dispose();
    }
}
```

### Whizbang Test Harness

**After (Whizbang)**:

```csharp
public class OrderIntegrationTests : IAsyncLifetime {
    private ServiceProvider _provider = null!;
    private IEventStore _eventStore = null!;

    public async Task InitializeAsync() {
        var services = new ServiceCollection();

        services.AddWhizbang(options => {
            options.UseInMemoryEventStore();  // In-memory for tests
        });

        _provider = services.BuildServiceProvider();
        _eventStore = _provider.GetRequiredService<IEventStore>();
    }

    [Test]
    public async Task CreateOrder_PersistsEventAsync() {
        // Arrange
        var orderId = Guid.CreateVersion7();
        var @event = new OrderCreated(orderId);
        var envelope = EnvelopeFactory.Create(@event);

        // Act
        await _eventStore.AppendAsync(orderId, envelope);

        // Assert
        var events = await _eventStore.ReadAsync<OrderCreated>(orderId, 0)
            .ToListAsync();
        await Assert.That(events).HasCount().EqualTo(1);
    }

    public async Task DisposeAsync() {
        await _provider.DisposeAsync();
    }
}
```

### TestContainers for PostgreSQL

```csharp
public class PostgresIntegrationTests : IAsyncLifetime {
    private PostgreSqlContainer _postgres = null!;
    private ServiceProvider _provider = null!;

    public async Task InitializeAsync() {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:16")
            .Build();

        await _postgres.StartAsync();

        var services = new ServiceCollection();
        services.AddWhizbang(options => {
            options.UsePostgres(_postgres.GetConnectionString());
        });

        _provider = services.BuildServiceProvider();

        // Initialize schema
        var initializer = _provider.GetRequiredService<ISchemaInitializer>();
        await initializer.InitializeAsync();
    }

    [Test]
    public async Task EventStore_WithRealPostgres_WorksAsync() {
        var eventStore = _provider.GetRequiredService<IEventStore>();
        var streamId = Guid.CreateVersion7();

        await eventStore.AppendAsync(streamId,
            EnvelopeFactory.Create(new OrderCreated(streamId)));

        var events = await eventStore.ReadAsync<OrderCreated>(streamId, 0)
            .ToListAsync();

        await Assert.That(events).HasCount().EqualTo(1);
    }

    public async Task DisposeAsync() {
        await _provider.DisposeAsync();
        await _postgres.DisposeAsync();
    }
}
```

## Test Data Generation

### Bogus Faker for Test Data

```csharp
public class OrderFaker : Faker<CreateOrder> {
    public OrderFaker() {
        RuleFor(o => o.CustomerId, f => Guid.CreateVersion7());
        RuleFor(o => o.Items, f => new OrderItemFaker().Generate(f.Random.Int(1, 5)));
        RuleFor(o => o.ShippingAddress, f => new AddressFaker().Generate());
    }
}

public class OrderItemFaker : Faker<OrderItem> {
    public OrderItemFaker() {
        RuleFor(i => i.ProductId, f => Guid.CreateVersion7());
        RuleFor(i => i.Quantity, f => f.Random.Int(1, 10));
        RuleFor(i => i.Price, f => f.Finance.Amount(1, 1000));
    }
}

// Usage in tests
[Test]
public async Task HandleAsync_ValidOrder_ProcessesCorrectlyAsync() {
    var faker = new OrderFaker();
    var command = faker.Generate();

    var result = await _receptor.HandleAsync(command);

    await Assert.That(result.OrderId).IsNotEqualTo(Guid.Empty);
}
```

## Async Test Patterns

### TUnit Async Assertions

```csharp
[Test]
public async Task Receptor_ThrowsOnInvalidInput_Async() {
    var receptor = new CreateOrderReceptor(_eventStore);
    var invalidCommand = new CreateOrder { Items = Array.Empty<OrderItem>() };

    await Assert.That(async () => await receptor.HandleAsync(invalidCommand))
        .ThrowsAsync<InvalidOperationException>()
        .WithMessage("Order must have at least one item");
}

[Test]
public async Task EventStore_ReturnsEventsInOrder_Async() {
    var streamId = Guid.CreateVersion7();

    await _eventStore.AppendAsync(streamId, EnvelopeFactory.Create(new Event1()));
    await _eventStore.AppendAsync(streamId, EnvelopeFactory.Create(new Event2()));
    await _eventStore.AppendAsync(streamId, EnvelopeFactory.Create(new Event3()));

    var events = await _eventStore.ReadAsync<IEvent>(streamId, 0).ToListAsync();

    await Assert.That(events).HasCount().EqualTo(3);
    await Assert.That(events[0].Payload).IsTypeOf<Event1>();
    await Assert.That(events[1].Payload).IsTypeOf<Event2>();
    await Assert.That(events[2].Payload).IsTypeOf<Event3>();
}
```

## Test Naming Convention

All async test methods must end with `Async`:

```csharp
// ✅ CORRECT
[Test]
public async Task HandleAsync_ValidInput_ReturnsExpectedResultAsync() { }

// ❌ WRONG
[Test]
public async Task HandleAsync_ValidInput_ReturnsExpectedResult() { }
```

## Running Tests

```bash
# Run all tests
dotnet test

# Run with parallel execution
dotnet test --max-parallel-test-modules 8

# Run specific test file
cd tests/MyApp.Tests
dotnet run -- --treenode-filter "/MyApp.Tests/*/OrderReceptorTests/*"

# Run with coverage
dotnet run -- --coverage --coverage-output-format cobertura
```

## Migration Checklist

- [ ] Replace xUnit/NUnit with TUnit
- [ ] Replace Moq/NSubstitute with Rocks
- [ ] Replace FluentAssertions with TUnit.Assertions
- [ ] Add `Async` suffix to all async test methods
- [ ] Update assertion syntax to `await Assert.That(...)`
- [ ] Update mock syntax to Rocks patterns
- [ ] Add Whizbang.Testing package
- [ ] Configure in-memory event store for unit tests
- [ ] Set up TestContainers for integration tests
- [ ] Update CI pipeline for TUnit

---

*Previous: [Outbox Migration](07-outbox-migration.md) | Next: [Migration Checklist](appendix-checklist.md)*
