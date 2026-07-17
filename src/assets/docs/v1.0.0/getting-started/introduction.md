---
title: Introduction to Whizbang
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Getting Started
order: 1
description: >-
  Learn about Whizbang - a zero-reflection, AOT-compatible .NET library for
  building event-driven, CQRS, and event-sourced applications
tags: 'introduction, overview, philosophy, getting-started'
codeReferences:
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/IReceptor.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
  - README.md
testReferences:
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherTests.cs
  - tests/Whizbang.Core.Tests/Receptors/ReceptorTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/IPerspectiveForTests.cs
lastMaintainedCommit: '01f07906'
---

# Introduction to Whizbang

Whizbang is a comprehensive .NET library for building event-driven, CQRS, and event-sourced applications with **zero reflection** and **native AOT compatibility** from day one.

## What is Whizbang?

Whizbang provides a complete foundation for building modern, scalable applications using message-driven architecture patterns. Unlike traditional frameworks that rely on runtime reflection, Whizbang uses **source generators** to discover and wire up your application components at compile time, resulting in:

- **Blazing Performance**: < 20ns in-process message dispatch with zero allocations
- **AOT Ready**: Full Native AOT support with no runtime surprises
- **Type Safety**: Compile-time verification of message handlers and routing
- **Developer Experience**: Rich IDE support with code navigation and discovery

## Philosophy

### Zero Reflection

Every feature in Whizbang is built without runtime reflection:

```csharp{title="Zero Reflection" description="Every feature in Whizbang is built without runtime reflection:" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-started", "C#", "Zero", "Reflection"]}
// Source generators discover this at compile time
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {

        // Business logic here
        return new OrderCreated(OrderId: TrackedGuid.NewMedo(), /* ... */);
    }
}

// Generated dispatcher code - no reflection!
// Routes messages at compile time with optimal performance
```

**Benefits**:
- Native AOT deployment out of the box
- Predictable performance (no reflection overhead)
- Compile-time safety (broken handlers = compiler errors)
- Faster startup times

### Type-Safe Messaging

Whizbang enforces type safety at compile time:

```csharp{title="Type-Safe Messaging" description="Whizbang enforces type safety at compile time:" category="Configuration" difficulty="BEGINNER" tags=["Getting-Started", "Type-Safe", "Messaging"]}
// Compiler knows CreateOrder → OrderCreated
var result = await dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);

// Type mismatch? Compiler error!
// var wrong = await dispatcher.LocalInvokeAsync<CreateOrder, PaymentProcessed>(command); // ❌
```

### Event-Driven Architecture

Built around three core patterns:

1. **Receptors**: Stateless message handlers that make decisions
2. **Perspectives**: Event listeners that maintain read models
3. **Lenses**: Query interfaces for optimized data access

```csharp{title="Event-Driven Architecture" description="Event-Driven Architecture" category="Configuration" difficulty="BEGINNER" tags=["Getting-Started", "Event-Driven", "Architecture"]}
// Receptor: Receives command, produces event
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> { }

// Perspective: Applies events to a read model (pure function)
public class OrderSummaryPerspective : IPerspectiveFor<OrderSummary, OrderCreated> { }

// Lens: Query interface for a read model (registered automatically per model)
public class OrderQueryService(ILensQuery<OrderSummary> lens) { }
```

## Core Concepts (Quick Overview)

### Dispatcher

Central message router with three dispatch patterns:

```csharp{title="Dispatcher" description="Central message router with three dispatch patterns:" category="Configuration" difficulty="BEGINNER" tags=["Getting-Started", "Dispatcher"]}
// SendAsync: Command dispatch with delivery receipt (can work over wire)
var receipt = await dispatcher.SendAsync(new CreateOrder(/* ... */));

// LocalInvokeAsync: In-process RPC with typed result (< 20ns, zero allocation)
var result = await dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);

// PublishAsync: Event broadcasting (fire-and-forget)
await dispatcher.PublishAsync(@event);
```

### Receptors

Stateless message handlers:

```csharp{title="Receptors" description="Stateless message handlers:" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Receptors"]}
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {

        // Validate
        if (message.Items.Count == 0) {
            throw new InvalidOperationException("Order must have items");
        }

        // Make decision, return event
        return new OrderCreated(
            OrderId: TrackedGuid.NewMedo(),
            CustomerId: message.CustomerId,
            Items: message.Items,
            Total: message.Items.Sum(i => i.Quantity * i.Price),
            CreatedAt: DateTimeOffset.UtcNow
        );
    }
}
```

### Perspectives

Event-driven read model updates via **pure Apply functions** — no I/O, no side effects; the framework handles persistence:

```csharp{title="Perspectives" description="Event-driven read model updates:" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Perspectives"]}
public sealed record OrderSummary {
    [StreamId]
    public Guid OrderId { get; init; }
    public Guid CustomerId { get; init; }
    public decimal Total { get; init; }
    public string Status { get; init; } = "";
    public DateTimeOffset CreatedAt { get; init; }
}

public class OrderSummaryPerspective : IPerspectiveFor<OrderSummary, OrderCreated> {
    public OrderSummary Apply(OrderSummary currentData, OrderCreated eventData) =>
        currentData with {
            OrderId = eventData.OrderId,
            CustomerId = eventData.CustomerId,
            Total = eventData.Total,
            Status = "Created",
            CreatedAt = eventData.CreatedAt
        };
}
```

### Lenses

Query-optimized read access. `ILensQuery<TModel>` is registered automatically for every discovered perspective model:

```csharp{title="Lenses" description="Query-optimized read repositories:" category="Configuration" difficulty="INTERMEDIATE" tags=["Getting-Started", "Lenses"]}
public class OrderQueryService(ILensQuery<OrderSummary> lens) {
    public Task<OrderSummary?> GetOrderAsync(Guid orderId, CancellationToken ct = default) =>
        lens.DefaultScope.GetByIdAsync(orderId, ct);

    public async Task<List<OrderSummary>> GetRecentOrdersAsync(CancellationToken ct = default) {
        return await lens.DefaultScope.Query
            .OrderByDescending(row => row.UpdatedAt)
            .Take(50)
            .Select(row => row.Data)
            .ToListAsync(ct);
    }
}
```

## Technology Stack (v1.0.0)

Whizbang is built on modern .NET:

| Technology | Version | Purpose |
|------------|---------|---------|
| .NET | 10.0 | Target framework |
| Source Generators | Roslyn | Compile-time discovery |
| `[WhizbangId]` generator | Built-in | Strongly-typed UUIDv7 IDs |
| EF Core | 10.0 | Primary data driver (Postgres) |
| Dapper | Latest | Lightweight data access option |
| Azure Service Bus / RabbitMQ | Latest | Message transports |
| PostgreSQL | 16+ | Primary database |
| .NET Aspire | Latest | Orchestration & observability |

## Project Structure (Library Projects)

```
whizbang/
├── src/
│   ├── Whizbang.Core/                          # Core interfaces, dispatcher, workers, pooling
│   ├── Whizbang.Generators/                    # Source generators (discovery)
│   ├── Whizbang.Data.EFCore.Postgres/          # EF Core + PostgreSQL driver
│   ├── Whizbang.Data.EFCore.Postgres.Generators/ # EF Core schema/registration generators
│   ├── Whizbang.Data.EFCore.Custom/            # EF Core attributes ([WhizbangDbContext])
│   ├── Whizbang.Data.Dapper.Postgres/          # Dapper + PostgreSQL
│   ├── Whizbang.Data.Dapper.Sqlite/            # Dapper + SQLite
│   ├── Whizbang.Data.Dapper.Custom/            # Dapper base classes
│   ├── Whizbang.Data.Postgres/                 # PostgreSQL utilities + migrations
│   ├── Whizbang.Data.Schema/                   # Schema definitions (wh_* tables)
│   ├── Whizbang.Transports.AzureServiceBus/    # Azure Service Bus transport
│   ├── Whizbang.Transports.RabbitMQ/           # RabbitMQ transport
│   ├── Whizbang.Transports.FastEndpoints/      # FastEndpoints integration
│   ├── Whizbang.Transports.HotChocolate/       # GraphQL integration
│   ├── Whizbang.Hosting.Azure.ServiceBus/      # Hosting extensions (ASB)
│   ├── Whizbang.Hosting.RabbitMQ/              # Hosting extensions (RabbitMQ)
│   ├── Whizbang.Sagas/                         # Saga support
│   ├── Whizbang.SignalR/                       # SignalR integration
│   ├── Whizbang.Observability/                 # Observability extensions
│   └── Whizbang.Testing/                       # Testing utilities
└── samples/
    └── ECommerce/                               # 12-project production sample
```

## Key Features (v1.0.0)

### Messaging Patterns

- ✅ **Outbox Pattern**: Reliable cross-service event publishing
- ✅ **Inbox Pattern**: Exactly-once message processing with deduplication
- ✅ **Work Coordination**: Atomic batch processing with lease-based distribution
- ✅ **Message Envelopes**: Hop-based observability for distributed tracing

### Data Access

- ✅ **Dapper Integration**: Lightweight, high-performance SQL
- ✅ **EF Core Integration**: Full-featured ORM with code-first migrations
- ✅ **Perspective Storage**: Optimized read model management
- ✅ **Event Store**: Append-only event storage with PostgreSQL

### Source Generators

- ✅ **Receptor Discovery**: Automatic handler registration
- ✅ **Perspective Discovery**: Event listener wiring
- ✅ **Message Registry**: VSCode extension integration
- ✅ **Aggregate IDs**: Strongly-typed identity generation
- ✅ **JSON Contexts**: AOT-compatible serialization

### Infrastructure

- ✅ **.NET Aspire**: Automatic orchestration and service discovery
- ✅ **Health Checks**: Database and message transport readiness
- ✅ **Object Pooling**: Zero-allocation performance patterns
- ✅ **Policy Engine**: Decision trails and cross-cutting concerns

### Transports

- ✅ **Azure Service Bus**: Production-ready message transport
- ✅ **RabbitMQ**: Production-ready message transport (local-dev friendly)
- ✅ **In-Memory**: Fast testing and development

## Real-World Example: ECommerce Sample

Whizbang includes a complete **12-project production sample** demonstrating:

- **Backend for Frontend (BFF)** with SignalR real-time updates
- **Microservices** (Order, Inventory, Payment, Shipping, Notification)
- **Angular UI** with NgRx state management
- **Event-driven workflows** with Outbox/Inbox patterns
- **.NET Aspire orchestration** for local development
- **Integration testing** with TUnit

**Services**:
- `ECommerce.BFF.API` - Backend for Frontend (perspectives + lenses + SignalR)
- `ECommerce.OrderService.API` - REST (FastEndpoints) + GraphQL order management
- `ECommerce.InventoryWorker` - Inventory reservation
- `ECommerce.PaymentWorker` - Payment processing
- `ECommerce.ShippingWorker` - Fulfillment coordination
- `ECommerce.NotificationWorker` - Cross-cutting notifications
- `ECommerce.UI` - Angular application

See [ECommerce Tutorial](../../drafts/metrics/overview.md) for complete walkthrough.

## When to Use Whizbang

### Perfect For

✅ **Event-Driven Applications**: Microservices, event sourcing, CQRS
✅ **High-Performance Systems**: Need < 20ns in-process dispatch
✅ **Native AOT Deployment**: Cloud-native, serverless, edge computing
✅ **Type-Safe Messaging**: Compile-time verification required
✅ **Complex Workflows**: Order processing, sagas, distributed transactions
✅ **Real-Time Systems**: SignalR integration for live updates

### Consider Alternatives If

❌ **Simple CRUD**: Whizbang is overkill for basic data entry apps
❌ **No Messaging Needs**: Traditional MVC/Razor Pages may be simpler
❌ **Learning Curve**: Team unfamiliar with event-driven patterns
❌ **Rapid Prototyping**: Source generators add compile-time overhead

## Performance Characteristics

| Operation | Target | Description |
|-----------|--------|-------------|
| LocalInvoke | < 20ns | In-process receptor invocation (zero allocation) |
| SendAsync | < 100μs | Outbox write + receipt generation |
| Perspective Update | < 50μs | Read model upsert |
| Lens Query | < 10μs | Indexed read model query |
| Source Generation | < 500ms | Full rebuild with all generators |

## Learning Path

### Beginner

1. [Installation](installation.md) - Set up your first project
2. [Quick Start](quick-start.md) - Hello World with Receptors + Dispatcher
3. [Project Structure](project-structure.md) - Organize your application
4. [Core Concepts: Receptors](../fundamentals/receptors/receptors.md) - Understand message handling
5. [Core Concepts: Dispatcher](../fundamentals/dispatcher/dispatcher.md) - Master message routing

### Intermediate

6. [Perspectives](../fundamentals/perspectives/perspectives.md) - Build read models
7. [Lenses](../fundamentals/lenses/lenses.md) - Query optimization
8. [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable messaging
9. [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once processing
10. [ECommerce Sample](../../drafts/metrics/overview.md) - Production patterns

### Advanced

11. [Source Generators](../extending/source-generators/receptor-discovery.md) - Understand code generation
12. [Extensibility](../../drafts/metrics/overview.md) - Custom implementations
13. Performance Tuning - Optimize for scale
14. Deployment - Production deployment

## Next Steps

Ready to get started?

→ **[Installation Guide](installation.md)** - Install Whizbang and create your first project

→ **[Quick Start Tutorial](quick-start.md)** - Build a working app in 10 minutes

→ **[ECommerce Sample](../../drafts/metrics/overview.md)** - Explore a production-ready example

## Community & Support

- **Documentation**: https://whizbang-lib.github.io
- **Source Code**: https://github.com/whizbang-lib/whizbang
- **Issues**: https://github.com/whizbang-lib/whizbang/issues
- **Samples**: https://github.com/whizbang-lib/whizbang/tree/main/samples

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
