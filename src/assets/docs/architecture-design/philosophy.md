---
title: Philosophy & Design Principles
category: Architecture & Design
order: 2
tags: philosophy, design-principles, vision
---

# Philosophy & Design Principles

Whizbang is a unified event-sourced data and messaging runtime for .NET that collapses the complexity of MartenDB, Wolverine, MassTransit, and MediatR into a single cohesive platform with one mental model.

## Core Philosophy

### Events as the Source of Truth

**Events are immutable facts that have happened.** In Whizbang, events are not just notifications—they are the authoritative record of everything that has occurred in your system. All aggregates and projections can be rebuilt or reimagined from the event stream at any time, even years after initial deployment.

This approach provides:
- **Complete audit trail** - Every state change is recorded forever
- **Time travel debugging** - Replay events to understand how state evolved
- **Flexible projections** - Build new read models from existing events
- **Migration freedom** - Refactor your domain model without losing history

### Single Surface Area

Teams waste cognitive energy context-switching between different APIs, patterns, and abstractions. Whizbang provides **one set of primitives** for:

- **Aggregates** - Write-side domain models that enforce business rules
- **Projections** - Read-side models optimized for queries
- **Commands** - Requests to change state, routed to domain owners
- **Queries** - Requests for data, executed against projections
- **Sagas** - Long-running processes that coordinate across domains

All of these concepts share the same handler model, dependency injection patterns, and testing approaches. Learn once, apply everywhere.

### One Runtime. Any Mode. Every Pattern.

**Write your business logic once. Run it anywhere.** Whizbang provides a unified mental model that scales from simple in-process messaging to complex distributed event-sourced systems—without changing your handlers.

```csharp
// This SAME handler works across ALL modes
public class OrderHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd) {
        // Your business logic here
        return new OrderCreated(cmd.OrderId);
    }
}

// Mode switching is just configuration
services.AddWhizbang().UseInProcessMode();    // Development
services.AddWhizbang().UseDurableMode();      // Single service
services.AddWhizbang().UseDistributedMode();  // Microservices
services.AddWhizbang().UseEventSourcedMode(); // Event sourcing
```

### Return Type Semantics

**What you return determines what happens.** No configuration files, no routing tables, no ceremony. Your intent is clear from your code:

```csharp
// Single return = single effect
return new OrderCreated();                           // Publishes event

// Tuple return = multiple effects
return (new OrderCreated(), new ProcessPayment());   // Cascading messages

// Result return = railway-oriented programming
return Result.Success(new OrderCreated());          // Success/failure handling

// Streaming return = real-time processing
yield return new OrderProcessed();                  // IAsyncEnumerable
```

### Aspect-Oriented by Design

**Cross-cutting concerns are first-class citizens.** Through source generators and compile-time weaving, aspects like logging, retry, caching, and authorization are declarative and performant:

```csharp
[Logged]
[Cached(Duration = "5m")]
[Retry(3, Backoff = "exponential")]
[Authorized(Role = "Admin")]
public class OrderHandler : IHandle<CreateOrder> {
    [Pure] // Compile-time verification of no side effects
    public OrderCreated Handle(CreateOrder cmd) {
        // All aspects automatically applied
        return new OrderCreated(cmd.OrderId);
    }
}
```

### From Simple to Scale

Whizbang is designed for **the full spectrum**:

**Simple Start**: Use Whizbang as an in-process mediator for CQRS without any infrastructure dependencies. Perfect for small apps or getting started.

**Growth Path**: Add event sourcing, projections, and persistence as your needs grow. Every feature is opt-in.

**Enterprise Scale**: Deploy across microservices with message brokers, multiple databases, multi-region disaster recovery, and Kubernetes auto-scaling.

**The same code works at every scale.** Your simple mediator handlers become distributed message handlers without rewrites.

### Progressive Enhancement

**Start simple. Add complexity only when needed.** Every Whizbang application follows the same growth path:

1. **In-Process** - Simple mediator, no infrastructure
2. **Durable** - Add persistence and retry
3. **Distributed** - Scale across services
4. **Event-Sourced** - Full event sourcing when needed

The same handler code works at every level. No rewrites as you scale.

## Design Principles

### 1. Driver-Based Architecture

**Never lock into a specific technology.** Whizbang uses a driver-based system for:

- **Persistence** - Postgres, SQL Server, MySQL, Cosmos DB, LiteFS/SQLite
- **Messaging** - Kafka, RabbitMQ, Azure Service Bus, AWS SQS, in-memory
- **Serialization** - JSON, Protobuf, MessagePack, custom formats
- **Observability** - OpenTelemetry, Application Insights, custom telemetry

Swap drivers through configuration, not code changes. Start with SQLite for local dev, move to Postgres in staging, scale to Cosmos DB in production—all with the same domain code.

### 2. Domain Ownership

**Every event and command has a home.** In distributed systems, clarity about ownership prevents chaos:

- **Commands** are sent TO the domain that owns them
- **Events** are emitted FROM the domain that owns them
- **New services** can subscribe to events and backfill projections from the entire event stream
- **Domain boundaries** are explicit in code and configuration

This prevents the "event spaghetti" problem where no one knows who publishes what, or where to send commands.

### 3. Convention Over Configuration

**Your code expresses intent through conventions.** Return types determine behavior. Attributes declare aspects. Source generators eliminate boilerplate. No XML files, no complex registration, no ceremony.

```csharp
// Return type determines what happens
public OrderCreated Handle(CreateOrder cmd) => new OrderCreated();        // Event
public ProcessPayment Handle(OrderCreated e) => new ProcessPayment();     // Command
public void Handle(LogActivity cmd) => Console.WriteLine(cmd.Message);   // Fire-and-forget

// Attributes declare behavior
[Pure]           // Compile-time verification of no side effects
[Idempotent]     // Automatic deduplication
[Transactional]  // Wrap in transaction
```

### 4. Observable by Default

**Problems found in production are 10x more expensive than problems found in development.** Whizbang includes:

- **OpenTelemetry traces** for every message, event, and projection
- **Live dashboard** showing message lag, projection health, and error rates
- **Distributed tracing** across services and message brokers
- **Performance budgets** that alert when handlers exceed latency targets

Observability is not bolted on—it's built into the core runtime.

### 5. Idempotence Everywhere

**Messages may be delivered more than once.** Whizbang ensures:

- **Exactly-once semantics** for event handling and projection updates
- **Automatic deduplication** based on message IDs
- **Outbox/Inbox pattern** for reliable message delivery across service boundaries
- **Idempotent consumers** that can safely process the same event multiple times

Your domain logic never needs to worry about duplicate messages.

### 6. Compile-Time Safety

**Catch errors during build, not at runtime.** Through source generators and Roslyn analyzers, Whizbang provides unprecedented compile-time verification:

```csharp
[Pure]
public class CalculationHandler : IHandle<Calculate> {
    public Result Handle(Calculate cmd) {
        // ✅ Pure computation allowed
        var result = cmd.A + cmd.B;
        
        // ❌ Compile error: I/O not allowed in pure function
        // await database.SaveAsync(result);
        
        return new Result(result);
    }
}

[Effects(Writes = "Orders", Publishes = "OrderEvents")]
public class OrderHandler : IHandle<CreateOrder> {
    // Source generator verifies declared effects match actual usage
}
```

### 7. AOT-Safe and Performance-First

**Modern .NET demands performance.** Whizbang achieves both developer experience and runtime performance through:

- **Source generation** - Zero runtime reflection overhead
- **Native AOT** - Full trimming and AOT compilation support
- **Struct messages** - Stack allocation for small messages
- **Object pooling** - Automatic pooling of handlers and messages
- **SIMD operations** - Vectorized operations where applicable

Deploy as a tiny container or serverless function without compromise.

### 8. Security and Multi-Tenancy First

**Security is not an afterthought.** Whizbang provides built-in support for:

- **Multi-tenancy** - Tenant isolation at the event stream, projection, and command level
- **Permission scoping** - Fine-grained authorization for commands, queries, and events
- **Trusted/untrusted boundaries** - Separate handling for internal vs external services
- **Audit logging** - Track who did what, when, and why
- **Data encryption** - At-rest and in-transit encryption support

**Multi-tenant architecture**:

- Tenant ID propagated through all message contexts
- Tenant-scoped event streams (e.g., `Tenant-{tenantId}-Order-{orderId}`)
- Tenant-specific projections and read models
- Cross-tenant operations prevented by default

**Permission model**:

- Commands require explicit permissions (e.g., `orders:place`, `inventory:reserve`)
- Queries can be scoped to accessible data only
- Events carry identity context for audit trails
- Roslyn analyzer enforces authorization checks

**Service trust boundaries**:

- Internal services (trusted) can access raw event streams
- External services (untrusted) receive filtered, sanitized events
- API gateways enforce authentication and authorization
- Service-to-service authentication via mutual TLS or tokens

## Opinionated Recipes, Flexible Foundation

Whizbang provides **opinionated recipes** to prevent analysis paralysis:

- **Starter templates** for common scenarios (web API, worker service, microservice)
- **Best practice examples** for aggregates, sagas, projections
- **Convention-based configuration** that "just works" out of the box

But under the hood, **everything is pluggable**:

- Swap drivers
- Override conventions
- Customize serialization
- Extend the pipeline

You're not locked into our opinions if your scenario demands something different.

## Comparison to Existing Tools

### vs. Marten + Wolverine (The "Critter Stack")

**What they are**: Marten is a document database and event store for PostgreSQL. Wolverine is a messaging and mediator framework. Together they form the "Critter Stack"—the most mature CQRS/ES stack in .NET as of 2025.

**Strengths**:

- Battle-tested in production since 2016
- Excellent PostgreSQL integration with partitioning, snapshotting, and "Quick Append"
- Full OpenTelemetry and metrics support
- "Aggregate handler workflow" for clean CQRS

**Whizbang Differences**:

- **Multi-database**: Marten is PostgreSQL-only. Whizbang supports Postgres, SQL Server, MySQL, Cosmos DB, and SQLite through drivers.
- **Unified runtime**: Marten + Wolverine are two separate libraries. Whizbang is a single, cohesive runtime.
- **Domain ownership**: Whizbang enforces explicit domain ownership for distributed systems (commands TO owner, events FROM owner).
- **Multi-tenancy first**: Built-in tenant isolation at the event stream, projection, and command level.
- **Aspire integration**: First-class .NET Aspire support with one-command local dev setup.
- **Lakehouse streaming**: Stream events to Delta Lake, Iceberg, or Parquet for analytics.
- **Dashboard**: Dedicated web dashboard for message journey visualization and control plane.

**When to choose Marten + Wolverine**: You're committed to PostgreSQL and want the most mature, proven stack.

**When to choose Whizbang**: You need multi-database support, tighter integration, multi-tenancy, or advanced features like lakehouse streaming.

---

### vs. MediatR

**What it is**: MediatR is a simple in-process mediator for implementing CQRS in a single application. Used by thousands of .NET projects.

**Strengths**:

- Extremely simple and lightweight
- No infrastructure dependencies
- Perfect for monolithic applications
- Minimal learning curve

**Whizbang Differences**:

- **Event sourcing**: MediatR has no event sourcing. Whizbang includes full event store support.
- **Projections**: MediatR has no read model support. Whizbang includes projection engine.
- **Distributed messaging**: MediatR is in-process only. Whizbang scales to microservices.
- **Growth path**: With MediatR, scaling to distributed requires a complete rewrite. With Whizbang, the same handler code works at every scale.

**When to choose MediatR**: You're building a simple monolith and will never need event sourcing or microservices.

**When to choose Whizbang**: You want a growth path from simple to complex without rewrites.

---

### vs. MassTransit

**What it is**: MassTransit is a mature distributed messaging framework for .NET. Supports RabbitMQ, Azure Service Bus, Amazon SQS, and more. Open source (Apache 2.0).

**Strengths**:

- Mature message routing, retries, and error handling
- Excellent transport abstraction (RabbitMQ, Azure Service Bus, etc.)
- Saga support for long-running processes
- Free for production use

**Whizbang Differences**:

- **Event sourcing**: MassTransit has no event sourcing. Whizbang includes event store.
- **Projections**: MassTransit has no read model support. Whizbang includes projection engine.
- **All-in-one**: MassTransit focuses on messaging. Whizbang integrates messaging + event sourcing + projections.
- **Mediator**: MassTransit requires a broker even for in-process. Whizbang starts as a simple mediator.

**When to choose MassTransit**: You only need messaging and already have event sourcing/projections handled separately.

**When to choose Whizbang**: You want a unified platform for CQRS/ES with messaging built-in.

---

### vs. NServiceBus

**What it is**: NServiceBus is the enterprise-grade service bus for .NET from Particular Software. The most feature-rich messaging framework.

**Strengths**:

- Comprehensive tooling (ServicePulse, ServiceInsight for monitoring)
- Enterprise support and training available
- Battle-tested in large-scale systems
- Advanced error handling and sagas

**Whizbang Differences**:

- **Licensing**: NServiceBus requires paid license for production. Whizbang is open source.
- **Event sourcing**: NServiceBus has no event sourcing. Whizbang includes event store.
- **Projections**: NServiceBus has no read model engine. Whizbang includes projection engine.
- **Dashboard**: NServiceBus has separate tools (ServicePulse, ServiceInsight). Whizbang has integrated dashboard.

**When to choose NServiceBus**: You need enterprise support and are willing to pay for it.

**When to choose Whizbang**: You want open-source, all-in-one CQRS/ES with messaging.

---

### vs. Equinox

**What it is**: Equinox is an event sourcing library from Jet.com (Walmart). Supports CosmosDB, DynamoDB, EventStoreDB, and SqlStreamStore backends. F#-first design.

**Strengths**:

- Polyglot storage (CosmosDB, DynamoDB, EventStoreDB, etc.)
- Sophisticated caching strategies
- Functional programming approach (F# first)
- Library, not framework (lightweight coupling)

**Whizbang Differences**:

- **C#-first**: Equinox is F#-first. Whizbang is designed for C# developers.
- **Messaging**: Equinox has no built-in messaging. Whizbang includes distributed messaging.
- **Projections**: Equinox requires separate Propulsion library. Whizbang includes projection engine.
- **Dashboard**: Equinox has no dashboard. Whizbang includes web dashboard.
- **Aspire**: Equinox has no Aspire integration. Whizbang has first-class Aspire support.

**When to choose Equinox**: You're building in F# and want a lightweight library.

**When to choose Whizbang**: You're building in C# and want an integrated framework.

---

### vs. EventStoreDB

**What it is**: EventStoreDB is a purpose-built event store database. The gold standard for event sourcing since 2012.

**Strengths**:

- Purpose-built for event sourcing
- Projections built into the database
- Catchup subscriptions and persistent subscriptions
- Mature and proven

**Whizbang Differences**:

- **Database dependency**: EventStoreDB is a separate database to run. Whizbang works with databases you already have (Postgres, SQL Server, etc.).
- **CQRS framework**: EventStoreDB is just storage. Whizbang includes mediator, messaging, projections, and dashboard.
- **Driver-based**: Whizbang isn't locked to one database. EventStoreDB is a single product.

**When to choose EventStoreDB**: You want the absolute best event store and are willing to run a dedicated database.

**When to choose Whizbang**: You want an all-in-one framework using databases you already have.

---

### Summary Comparison

| Feature | Whizbang | Marten + Wolverine | MediatR | MassTransit | NServiceBus | Equinox | EventStoreDB |
|---------|----------|-------------------|---------|-------------|-------------|---------|--------------|
| **Event Sourcing** | ✅ Built-in | ✅ Marten | ❌ | ❌ | ❌ | ✅ Library | ✅ Database |
| **Projections** | ✅ Built-in | ✅ Marten | ❌ | ❌ | ❌ | ⚠️ Propulsion | ✅ Built-in |
| **Messaging** | ✅ Built-in | ✅ Wolverine | ❌ | ✅ Core focus | ✅ Core focus | ❌ | ❌ |
| **Mediator** | ✅ Built-in | ✅ Wolverine | ✅ Core focus | ⚠️ Via broker | ❌ | ❌ | ❌ |
| **Multi-database** | ✅ Yes | ❌ Postgres only | N/A | N/A | N/A | ✅ Yes | ❌ Own DB |
| **Dashboard** | ✅ Included | ❌ | ❌ | ❌ | ✅ Paid tools | ❌ | ✅ UI |
| **Multi-tenancy** | ✅ First-class | ⚠️ Manual | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Aspire** | ✅ First-class | ⚠️ Community | ❌ | ⚠️ Community | ❌ | ❌ | ⚠️ Community |
| **License** | 🟢 Open source | 🟢 Open source | 🟢 Open source | 🟢 Apache 2.0 | 🔴 Commercial | 🟢 Apache 2.0 | 🟡 Free/Paid |
| **C# vs F#** | C#-first | C#-first | C#-first | C#-first | C#-first | F#-first | Language-agnostic |

**Key Insight**: Whizbang is the only library that combines event sourcing, projections, messaging, mediator, multi-tenancy, and dashboard into a single, cohesive runtime with multi-database support.

## Our Stance

**We believe:**

- Events are more valuable than current state
- Domain ownership prevents distributed system chaos
- Pure functions are easier to test and reason about
- Observability must be built in, not bolted on
- AOT and small binaries matter for modern deployments
- Developers should never be locked into a specific database or message broker
- Simple scenarios should stay simple; complex scenarios should be possible

## Next Steps

Now that you understand Whizbang's philosophy and design principles:

- [**Getting Started**](./getting-started.md) - Build your first Whizbang application with a step-by-step tutorial
- [**Package Structure**](./package-structure.md) - Learn about all available NuGet packages and their dependencies
- [**Core Concepts**](./core-concepts.md) - Deep dive into commands, events, projections, and aggregates

**We are building Whizbang to be the pit of success for event-sourced, message-driven systems in .NET.**
