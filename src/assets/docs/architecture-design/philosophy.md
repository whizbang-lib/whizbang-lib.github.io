---
title: Philosophy & Design Principles
category: Architecture & Design
order: 2
tags: philosophy, design-principles, vision
---

# Philosophy & Design Principles

Whizbang is a unified event-driven and event-sourced runtime for .NET that collapses the complexity of MartenDB, Wolverine, MassTransit, and MediatR into a single cohesive platform with receptors, perspectives, and lenses.

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

- **Receptors** - Decision-makers that receive commands and emit events
- **Perspectives** - Event handlers that update read models and external systems
- **Lenses** - Read-only interfaces for querying data
- **Commands** - Requests to change state, routed to domain owners
- **Events** - Immutable facts that represent state changes
- **Sagas** - Long-running processes that coordinate across domains

All of these concepts share the same dispatcher model, dependency injection patterns, and testing approaches. Learn once, apply everywhere.

### One Runtime. Any Mode. Every Pattern.

**Write your business logic once. Run it anywhere.** Whizbang provides a unified mental model that scales from event-driven development to complex distributed event-sourced systems—without changing your receptors.

```csharp
// This SAME receptor works across ALL modes
public class OrderReceptor : IReceptor<CreateOrder> {
    public OrderCreated Receive(CreateOrder cmd) {
        // Your business logic here
        return new OrderCreated(cmd.OrderId);
    }
}

// Mode switching is just configuration
services.AddWhizbang(d => d.UseEventDrivenMode());     // Development
services.AddWhizbang(d => d.UseEventDrivenMode());     // Production with perspectives
services.AddWhizbang(d => d.UseDistributedMode());     // Microservices with relays
services.AddWhizbang(d => d.UseEventSourcing());       // Event sourcing with ledger
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
public class OrderReceptor : IReceptor<CreateOrder> {
    [Pure] // Compile-time verification of no side effects
    public OrderCreated Receive(CreateOrder cmd) {
        // All aspects automatically applied
        return new OrderCreated(cmd.OrderId);
    }
}
```

### From Simple to Scale

Whizbang is designed for **the full spectrum**:

**Simple Start**: Use Whizbang as event-driven architecture with in-memory perspectives. Perfect for development and simple applications.

**Growth Path**: Add perspective persistence, event sourcing with ledger, and distributed relays as your needs grow. Every feature is opt-in.

**Enterprise Scale**: Deploy across microservices with message brokers, multiple databases, multi-region disaster recovery, and Kubernetes auto-scaling.

**The same code works at every scale.** Your simple receptors become distributed event-sourced receptors without rewrites.

### Progressive Enhancement

**Start simple. Add complexity only when needed.** Every Whizbang application follows the same growth path:

1. **Event-Driven Development** - Stateless receptors with in-memory perspectives
2. **Event-Driven Production** - Persistent perspectives with retry
3. **Event-Driven Distributed** - Scale across services with relays
4. **Event-Sourced** - Stateful receptors with ledger when needed

The same receptor code works at every level. No rewrites as you scale.

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

### 3. Receptors as Pure Functions

**Receptors are just C# methods that return events.** No magic base classes, no required interfaces (unless you want them), no framework coupling.

Mark a receptor as `pure` and the Roslyn analyzer **forbids hidden side effects**—guaranteeing your receptor is a true function from input to output.

```csharp
[Pure]
public OrderCalculated Receive(CalculateOrder cmd) {
    // ✅ Pure computation allowed
    return new OrderCalculated(cmd.Items.Sum(i => i.Price));
    
    // ❌ Compile error: Side effects not allowed in pure receptor
    // await database.SaveAsync(result);
}
```

### 4. Convention Over Configuration

**Your code expresses intent through conventions.** Return types determine behavior. Attributes declare aspects. Source generators eliminate boilerplate. No XML files, no complex registration, no ceremony.

```csharp
// Return type determines what happens
public OrderCreated Receive(CreateOrder cmd) => new OrderCreated();      // Event to perspectives
public ProcessPayment Receive(OrderCreated e) => new ProcessPayment();   // Command to other receptor
public void Receive(LogActivity cmd) => Console.WriteLine(cmd.Message);  // Fire-and-forget

// Attributes declare behavior
[Idempotent]     // Automatic deduplication
[Transactional]  // Wrap in transaction
[Logged]         // Structured logging
```

### 5. Observable by Default

**Problems found in production are 10x more expensive than problems found in development.** Whizbang includes:

- **OpenTelemetry traces** for every command, event, and perspective update
- **Live dashboard** showing message lag, perspective health, and error rates
- **Distributed tracing** across services and message brokers
- **Performance budgets** that alert when receptors exceed latency targets

Observability is not bolted on—it's built into the core runtime.

### 6. Idempotence Everywhere

**Messages may be delivered more than once.** Whizbang ensures:

- **Exactly-once semantics** for event handling and perspective updates
- **Automatic deduplication** based on message IDs
- **Outbox/Inbox pattern** for reliable message delivery across service boundaries
- **Idempotent perspectives** that can safely process the same event multiple times

Your domain logic never needs to worry about duplicate messages.

### 7. Compile-Time Safety

**Catch errors during build, not at runtime.** Through source generators and Roslyn analyzers, Whizbang provides unprecedented compile-time verification:

```csharp
[Pure]
public class CalculationReceptor : IReceptor<Calculate> {
    public Result Receive(Calculate cmd) {
        // ✅ Pure computation allowed
        var result = cmd.A + cmd.B;
        
        // ❌ Compile error: I/O not allowed in pure function
        // await database.SaveAsync(result);
        
        return new Result(result);
    }
}

[Effects(Writes = "Orders", Publishes = "OrderEvents")]
public class OrderReceptor : IReceptor<CreateOrder> {
    // Source generator verifies declared effects match actual usage
}
```

### 8. AOT-Safe and Performance-First

**Modern .NET demands performance.** Whizbang achieves both developer experience and runtime performance through:

- **Source generation** - Zero runtime reflection overhead
- **Native AOT** - Full trimming and AOT compilation support
- **Assembly trimming** - Only include what you use
- **Struct messages** - Stack allocation for small messages
- **Object pooling** - Automatic pooling of receptors and messages
- **SIMD operations** - Vectorized operations where applicable

Deploy as a tiny container or serverless function without compromise.

### 9. Security and Multi-Tenancy First

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

- **Event sourcing**: MediatR has no event sourcing. Whizbang includes full ledger support.
- **Perspectives**: MediatR has no read model support. Whizbang includes perspective engine.
- **Distributed messaging**: MediatR is in-process only. Whizbang scales to microservices.
- **Growth path**: With MediatR, scaling to distributed requires a complete rewrite. With Whizbang, the same receptor code works at every scale.

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

- **Event sourcing**: MassTransit has no event sourcing. Whizbang includes ledger.
- **Perspectives**: MassTransit has no read model support. Whizbang includes perspective engine.
- **All-in-one**: MassTransit focuses on messaging. Whizbang integrates messaging + event sourcing + perspectives.
- **Event-driven**: MassTransit requires a broker even for in-process. Whizbang starts as event-driven architecture.

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
- **Event sourcing**: NServiceBus has no event sourcing. Whizbang includes ledger.
- **Perspectives**: NServiceBus has no read model engine. Whizbang includes perspective engine.
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
- **Perspectives**: Equinox requires separate Propulsion library. Whizbang includes perspective engine.
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
- **CQRS framework**: EventStoreDB is just storage. Whizbang includes dispatcher, messaging, perspectives, and dashboard.
- **Driver-based**: Whizbang isn't locked to one database. EventStoreDB is a single product.

**When to choose EventStoreDB**: You want the absolute best event store and are willing to run a dedicated database.

**When to choose Whizbang**: You want an all-in-one framework using databases you already have.

---

### Summary Comparison

| Feature | Whizbang | Marten + Wolverine | MediatR | MassTransit | NServiceBus | Equinox | EventStoreDB |
|---------|----------|-------------------|---------|-------------|-------------|---------|--------------|
| **Event Sourcing** | ✅ Built-in | ✅ Marten | ❌ | ❌ | ❌ | ✅ Library | ✅ Database |
| **Perspectives** | ✅ Built-in | ✅ Marten | ❌ | ❌ | ❌ | ⚠️ Propulsion | ✅ Built-in |
| **Messaging** | ✅ Built-in | ✅ Wolverine | ❌ | ✅ Core focus | ✅ Core focus | ❌ | ❌ |
| **Event-Driven** | ✅ Built-in | ✅ Wolverine | ✅ Core focus | ⚠️ Via broker | ❌ | ❌ | ❌ |
| **Multi-database** | ✅ Yes | ❌ Postgres only | N/A | N/A | N/A | ✅ Yes | ❌ Own DB |
| **Dashboard** | ✅ Included | ❌ | ❌ | ❌ | ✅ Paid tools | ❌ | ✅ UI |
| **Multi-tenancy** | ✅ First-class | ⚠️ Manual | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Aspire** | ✅ First-class | ⚠️ Community | ❌ | ⚠️ Community | ❌ | ❌ | ⚠️ Community |
| **License** | 🟢 Open source | 🟢 Open source | 🟢 Open source | 🟢 Apache 2.0 | 🔴 Commercial | 🟢 Apache 2.0 | 🟡 Free/Paid |
| **C# vs F#** | C#-first | C#-first | C#-first | C#-first | C#-first | F#-first | Language-agnostic |

**Key Insight**: Whizbang is the only library that combines event sourcing, perspectives, messaging, event-driven patterns, multi-tenancy, and dashboard into a single, cohesive runtime with multi-database support.

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
- [**Core Concepts**](/docs/core-concepts/receptors) - Deep dive into receptors, perspectives, lenses, and events

**We are building Whizbang to be the pit of success for event-sourced, message-driven systems in .NET.**
