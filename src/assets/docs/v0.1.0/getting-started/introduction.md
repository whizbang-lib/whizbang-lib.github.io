---
title: "Introduction to Whizbang"
version: 0.1.0
category: Getting Started
order: 1
description: "Learn about Whizbang - a zero-reflection, AOT-compatible .NET library for building event-driven, CQRS, and event-sourced applications"
tags: introduction, overview, philosophy, getting-started
codeReferences:
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/IReceptor.cs
  - src/Whizbang.Core/IPerspectiveOf.cs
  - README.md
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

```csharp
// Source generators discover this at compile time
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {

        // Business logic here
        return new OrderCreated(OrderId: Guid.CreateVersion7(), /* ... */);
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

```csharp
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

```csharp
// Receptor: Receives command, produces event
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> { }

// Perspective: Listens to events, updates read model
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> { }

// Lens: Query interface for read model
public class OrderLens : ILensQuery { }
```

## Core Concepts (Quick Overview)

### Dispatcher

Central message router with three dispatch patterns:

```csharp
// SendAsync: Command dispatch with delivery receipt (can work over wire)
var receipt = await dispatcher.SendAsync(new CreateOrder(/* ... */));

// LocalInvokeAsync: In-process RPC with typed result (< 20ns, zero allocation)
var result = await dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);

// PublishAsync: Event broadcasting (fire-and-forget)
await dispatcher.PublishAsync(@event);
```

### Receptors

Stateless message handlers:

```csharp
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
            OrderId: Guid.CreateVersion7(),
            CustomerId: message.CustomerId,
            Items: message.Items,
            Total: message.Items.Sum(i => i.Quantity * i.Price),
            CreatedAt: DateTimeOffset.UtcNow
        );
    }
}
```

### Perspectives

Event-driven read model updates:

```csharp
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task Update(OrderCreated @event, CancellationToken ct = default) {
        // Update denormalized read model
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "INSERT INTO order_summaries (order_id, customer_id, total, status, created_at) VALUES (@OrderId, @CustomerId, @Total, @Status, @CreatedAt)",
            new {
                @event.OrderId,
                @event.CustomerId,
                @event.Total,
                Status = "Created",
                @event.CreatedAt
            }
        );
    }
}
```

### Lenses

Query-optimized read repositories:

```csharp
public class OrderLens : ILensQuery {
    private readonly IDbConnectionFactory _db;

    public async Task<OrderSummary?> GetOrderAsync(Guid orderId) {
        await using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<OrderSummary>(
            "SELECT * FROM order_summaries WHERE order_id = @OrderId",
            new { OrderId = orderId }
        );
    }
}
```

## Technology Stack (v0.1.0)

Whizbang is built on modern .NET:

| Technology | Version | Purpose |
|------------|---------|---------|
| .NET | 10.0 | Target framework (RC2+) |
| Source Generators | Roslyn 4.8+ | Compile-time discovery |
| Vogen | 8.0+ | Strongly-typed IDs |
| Dapper | Latest | Lightweight data access |
| EF Core | 10.0 | Full-featured ORM option |
| Azure Service Bus | Latest | Message transport |
| PostgreSQL | 16+ | Primary database |
| .NET Aspire | Latest | Orchestration & observability |

## Project Structure (15 Library Projects)

```
whizbang/
├── src/
│   ├── Whizbang.Core/                          # Core interfaces, dispatcher, pooling
│   ├── Whizbang.Generators/                    # Source generators (discovery)
│   ├── Whizbang.Generators.Shared/             # Shared generator utilities
│   ├── Whizbang.Data.Dapper.Postgres/          # Dapper + PostgreSQL
│   ├── Whizbang.Data.Dapper.Sqlite/            # Dapper + SQLite
│   ├── Whizbang.Data.Dapper.Custom/            # Dapper base classes
│   ├── Whizbang.Data.EFCore.Postgres/          # EF Core + PostgreSQL
│   ├── Whizbang.Data.EFCore.Postgres.Generators/ # EF Core generators
│   ├── Whizbang.Data.EFCore.Custom/            # EF Core attributes
│   ├── Whizbang.Data.Postgres/                 # PostgreSQL utilities
│   ├── Whizbang.Data.Schema/                   # Schema definition
│   ├── Whizbang.Transports.AzureServiceBus/    # Azure Service Bus transport
│   ├── Whizbang.Hosting.Azure.ServiceBus/      # Hosting extensions
│   └── Whizbang.Testing/                       # Testing utilities
└── samples/
    └── ECommerce/                               # 12-project production sample
```

## Key Features (v0.1.0)

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
- ✅ **In-Memory**: Fast testing and development

## Real-World Example: ECommerce Sample

Whizbang includes a complete **12-project production sample** demonstrating:

- **Backend for Frontend (BFF)** with SignalR real-time updates
- **Microservices** (Order, Inventory, Payment, Shipping, Notification)
- **Angular 20 UI** with NgRx state management
- **Event-driven workflows** with Outbox/Inbox patterns
- **.NET Aspire orchestration** for local development
- **Integration testing** with TUnit

**Services**:
- `ECommerce.BFF.API` - Backend for Frontend (perspectives + lenses + SignalR)
- `ECommerce.OrderService.API` - REST + GraphQL order management
- `ECommerce.InventoryWorker` - Inventory reservation
- `ECommerce.PaymentWorker` - Payment processing
- `ECommerce.ShippingWorker` - Fulfillment coordination
- `ECommerce.NotificationWorker` - Cross-cutting notifications
- `ECommerce.UI` - Angular 20 application

See [ECommerce Tutorial](../examples/ecommerce/overview.md) for complete walkthrough.

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
| Perspective Update | < 50μs | Read model update via Dapper |
| Lens Query | < 10μs | Dapper query execution |
| Source Generation | < 500ms | Full rebuild with all generators |

## Learning Path

### Beginner

1. [Installation](installation.md) - Set up your first project
2. [Quick Start](quick-start.md) - Hello World with Receptors + Dispatcher
3. [Project Structure](project-structure.md) - Organize your application
4. [Core Concepts: Receptors](../core-concepts/receptors.md) - Understand message handling
5. [Core Concepts: Dispatcher](../core-concepts/dispatcher.md) - Master message routing

### Intermediate

6. [Perspectives](../core-concepts/perspectives.md) - Build read models
7. [Lenses](../core-concepts/lenses.md) - Query optimization
8. [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable messaging
9. [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once processing
10. [ECommerce Sample](../examples/ecommerce/overview.md) - Production patterns

### Advanced

11. [Source Generators](../generators/receptor-discovery.md) - Understand code generation
12. [Extensibility](../extensibility/overview.md) - Custom implementations
13. [Performance Tuning](../performance/pooling-strategies.md) - Optimize for scale
14. [Deployment](../deployment/aspire-production.md) - Production deployment

## Next Steps

Ready to get started?

→ **[Installation Guide](installation.md)** - Install Whizbang and create your first project

→ **[Quick Start Tutorial](quick-start.md)** - Build a working app in 10 minutes

→ **[ECommerce Sample](../examples/ecommerce/overview.md)** - Explore a production-ready example

## Community & Support

- **Documentation**: https://whizbang-lib.github.io
- **Source Code**: https://github.com/whizbang/whizbang
- **Issues**: https://github.com/whizbang/whizbang/issues
- **Samples**: https://github.com/whizbang/whizbang/tree/main/samples

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
