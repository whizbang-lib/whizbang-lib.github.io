---
title: Architecture Overview
category: Architecture & Design
order: 1
description: Explore Whizbang's layered architecture that scales from event-driven development to full distributed event-sourced systems with receptors, perspectives, lenses, and domain ownership.
tags: architecture, design, system-design
---

# Architecture Overview

Whizbang is built on a layered architecture that supports scaling from event-driven development to a full distributed event-sourced system with receptors, perspectives, and lenses.

## Architectural Layers

```text
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Layered-Architecture, System-Design]
description: Layered architecture diagram showing the separation between application layer, Whizbang dispatcher, driver layer, and infrastructure
---
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                       │
│  (Your Domain Code: Receptors, Perspectives, Lenses)        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Whizbang Dispatcher                       │
│  • Message Routing        • Event Sourcing Engine            │
│  • Receptor Execution     • Perspective Management           │
│  • Event Publishing       • Ledger Coordination              │
│  • Idempotence            • Observability Pipeline           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      Driver Layer                            │
│  • Persistence Drivers    • Message Broker Adapters          │
│  • Serialization Drivers  • Telemetry Drivers                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Infrastructure                             │
│  • Databases              • Message Brokers                  │
│  • Telemetry Backends     • Service Discovery                │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Dispatcher with Return Type Semantics

The **Dispatcher** is the heart of Whizbang. It interprets receptor return types to determine behavior:

- Routes **commands** to their owning domain's receptors
- Publishes **events** to all interested perspectives  
- Executes **queries** against lenses
- Coordinates **sagas** across long-running processes
- **Return type semantics** - What receptors return determines what happens:
  - Single event return → Published to perspectives
  - Tuple return → Multiple cascading events
  - Void return → Fire-and-forget execution
  - Result<T> return → Success/failure handling

All message routing respects **domain ownership**—commands must be sent to the service that owns that receptor, while events are broadcast from the owning domain to perspectives.

### 2. Ledger

The **Ledger** is the source of truth for all state changes in event-sourced mode. It:

- Appends events to immutable streams (one stream per receptor)
- Supports **time-based queries** (get all events before/after a timestamp)
- Enables **backfilling** new perspectives from historical events
- Provides **global ordering** for cross-receptor event streams
- Implements **optimistic concurrency** for receptor updates

The Ledger is **driver-based**, supporting:
- Postgres (JSONB + sequential IDs)
- SQL Server (JSON columns + IDENTITY)
- MySQL (JSON columns + auto-increment)
- Cosmos DB (native event streams)
- LiteFS/SQLite (binary codec for edge deployments)

### 3. Perspective Engine

The **Perspective Engine** builds read models from event streams. It:

- Subscribes to event streams (local or from remote services)
- Applies events to perspective handlers in order
- Tracks **checkpoint positions** to resume after restarts
- Supports **parallel processing** across partitions
- Handles **schema migrations** for evolving perspectives

Perspectives can be:
- **Inline** - Updated synchronously within the same transaction as event append
- **Async** - Updated in background workers for eventual consistency
- **Cached** - Materialized in-memory for ultra-low latency
- **External** - Pushed to Elasticsearch, Redis, or other specialized stores

### 4. Aspect-Oriented Pipeline

The **AOP Pipeline** weaves cross-cutting concerns through source generation:

```text
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, AOP, Pipeline, Cross-Cutting-Concerns]
description: Aspect-oriented pipeline showing how cross-cutting concerns are applied through message processing
---
Incoming Message
      ↓
  [Logged] - Structured logging aspect
      ↓
  [Validated] - Input validation aspect
      ↓
  [Authorized] - Security aspect
      ↓
  [Cached] - Result caching aspect
      ↓
  [Retry] - Resilience aspect
      ↓
  [Timed] - Performance metrics aspect
      ↓
  Receptor Execution
      ↓
  [Transactional] - Database transaction aspect
      ↓
  Event Append / Perspective Update
      ↓
  [Outbox] - Distributed messaging aspect
      ↓
  Response / New Messages
```

Aspects are:
- **Declarative** - Applied via attributes
- **Compiled** - Source generators create zero-overhead code
- **Composable** - Multiple aspects work together
- **Testable** - Can be verified in isolation

Every stage is **pluggable** and **observable**.

### 5. Saga Coordinator

**Sagas** orchestrate long-running processes across multiple receptors or services. Whizbang supports two saga styles:

**Orchestration** - A central coordinator issues commands and listens for events:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Sagas, Orchestration, Long-Running-Processes]
description: Example of saga orchestration pattern for order fulfillment process
---
public class OrderFulfillmentSaga : Saga {
    public async Task Handle(OrderPlaced @event) {
        await Send(new ReserveInventory(@event.OrderId));
    }

    public async Task Handle(InventoryReserved @event) {
        await Send(new ChargePayment(@event.OrderId));
    }

    public async Task Handle(PaymentCharged @event) {
        await Send(new ShipOrder(@event.OrderId));
    }
}
```

**Choreography** - Each service reacts to events and publishes new ones (no central coordinator).

Sagas are persisted as event streams and can be replayed or debugged like any other receptor.

### 6. Outbox/Inbox Pattern

For **distributed messaging**, Whizbang implements the Outbox/Inbox pattern to ensure exactly-once delivery:

**Outbox** (Publishing Service):
1. Receptor executes and appends events to ledger
2. Events also written to **outbox table** in same transaction
3. Background worker publishes outbox messages to message broker
4. Messages marked as published after broker confirms

**Inbox** (Subscribing Service):
1. Message arrives from broker
2. Stored in **inbox table** with unique message ID
3. If message ID exists (duplicate), skip processing
4. Otherwise, process receptor and mark message as complete
5. Periodic cleanup of old inbox entries

This pattern guarantees **at-least-once delivery** from the broker combined with **idempotent handling** for exactly-once semantics.

## Domain Ownership Model

Whizbang enforces **explicit domain ownership** to prevent distributed system chaos.

### Commands

Commands are **sent TO** the service that owns the receptor:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Domain-Ownership, Commands, CQRS]
description: Example of command with domain ownership declaration
---
[OwnedBy("Orders")]  // This command belongs to the Orders service
public record PlaceOrder(Guid OrderId, Guid CustomerId, List<OrderItem> Items);
```

When you send a command:
- In a **monolith**, it's routed to the local receptor
- In **microservices**, it's routed to the Orders service via the message broker

### Events

Events are **emitted FROM** the service that owns the domain:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Domain-Ownership, Events, CQRS]
description: Example of event with domain ownership declaration
---
[OwnedBy("Orders")]  // This event comes from the Orders service
public record OrderPlaced(Guid OrderId, Guid CustomerId, DateTimeOffset PlacedAt);
```

Other services can subscribe to `OrderPlaced` events:
- In a **monolith**, subscribers get events via in-process pub/sub
- In **microservices**, subscribers get events from the message broker topic

### Backfilling Projections

When a new service subscribes to events for the first time, it can **backfill from the beginning**:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Perspectives, Event-Sourcing, Backfilling]
description: Configuration for perspective with event subscription and backfilling from beginning
---
services.AddPerspective<OrderHistoryPerspective>(options => {
    options.Subscribe<OrderPlaced>();
    options.Subscribe<OrderShipped>();
    options.BackfillFrom = DateTimeOffset.MinValue;  // Start from the beginning
});
```

The perspective engine will:
1. Query the Orders service's ledger for all historical events
2. Apply them to the perspective in order
3. Continue processing new events as they arrive

This allows new perspectives to be built from existing event history.

## Scaling Patterns

### Single Process (Event-Driven Mode)

```text
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Deployment, Single-Process, Event-Driven]
description: Single process deployment architecture with in-memory runtime and local database
---
┌─────────────────────────────┐
│   ASP.NET Core Web API      │
│                             │
│  ┌──────────────────────┐   │
│  │  Whizbang Runtime    │   │
│  │  (In-Memory)         │   │
│  └──────────────────────┘   │
│           ↓                 │
│  ┌──────────────────────┐   │
│  │  SQLite / Postgres   │   │
│  └──────────────────────┘   │
└─────────────────────────────┘
```

Perfect for:
- Event-driven applications
- Local development
- Simple event-driven patterns without event sourcing

### Multi-Service (Distributed)

```text
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Microservices, Distributed, Event-Driven]
description: Multi-service distributed architecture with dedicated databases and shared message broker
---
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Orders    │      │  Inventory  │      │  Shipping   │
│   Service   │      │   Service   │      │   Service   │
│             │      │             │      │             │
│  Whizbang   │      │  Whizbang   │      │  Whizbang   │
│             │      │             │      │             │
│  Postgres   │      │  Postgres   │      │  Postgres   │
└──────┬──────┘      └──────┬──────┘      └──────┬──────┘
       │                    │                    │
       └────────────┬───────┴────────────────────┘
                    ↓
          ┌──────────────────┐
          │  Kafka / RabbitMQ│
          │  (Message Broker)│
          └──────────────────┘
```

Each service:
- Has its own ledger for **database isolation**
- Publishes events to the shared message broker
- Subscribes to events from other services
- Routes commands to owning services

### Multi-Region (Disaster Recovery)

```text
---
category: Architecture
difficulty: ADVANCED
tags: [Architecture, Multi-Region, Disaster-Recovery, Replication]
description: Multi-region architecture with synchronized ledgers and mirrored message brokers for disaster recovery
---
        Region 1                         Region 2
┌─────────────────────┐         ┌─────────────────────┐
│  Primary Services   │         │  Replica Services   │
│                     │         │                     │
│  Ledgers            │◄───────►│  Ledgers            │
│  (Postgres)         │  Sync   │  (Postgres)         │
└─────────────────────┘         └─────────────────────┘
         ↓                               ↓
┌─────────────────────┐         ┌─────────────────────┐
│  Kafka Cluster      │◄───────►│  Kafka Cluster      │
│  (Region 1)         │  Mirror │  (Region 2)         │
└─────────────────────┘         └─────────────────────┘
```

Event streams in ledgers are replicated across regions for disaster recovery. Region 2 can take over if Region 1 fails.

## Progressive Enhancement Modes

Whizbang provides four deployment modes, all using the **exact same receptor code**:

### Mode 1: Event-Driven Development
```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Configuration, Event-Driven, Development]
description: Basic event-driven mode configuration for development scenarios
---
services.AddWhizbang(dispatcher => {
    dispatcher.UseEventDrivenMode();
});
```
- No persistence dependencies
- Immediate execution with in-memory perspectives
- Perfect for development and testing

### Mode 2: Event-Driven Production
```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Configuration, Event-Driven, Production, Persistence]
description: Event-driven production configuration with persistent perspectives
---
services.AddWhizbang(dispatcher => {
    dispatcher.UseEventDrivenMode();
    dispatcher.Perspectives.UsePostgreSQL(connectionString);
});
```
- Persistent perspectives
- Automatic retry on perspective failures
- Durable event processing

### Mode 3: Event-Driven Distributed
```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Configuration, Event-Driven, Distributed, Messaging]
description: Event-driven distributed configuration with Kafka relays and persistent perspectives
---
services.AddWhizbang(dispatcher => {
    dispatcher.UseEventDrivenMode();
    dispatcher.UseRelays(relays => relays.UseKafka(kafkaConfig));
    dispatcher.Perspectives.UsePostgreSQL(connectionString);
});
```
- Cross-service messaging with relays
- Service discovery
- Distributed tracing

### Mode 4: Event-Sourced with Ledger
```csharp
---
category: Architecture
difficulty: ADVANCED
tags: [Architecture, Configuration, Event-Sourcing, Ledger, Advanced]
description: Event-sourced configuration with ledger and persistent perspectives
---
services.AddWhizbang(dispatcher => {
    dispatcher.UseEventSourcing(es => {
        es.UseLedger(ledgerConfig);
    });
    dispatcher.Perspectives.UsePostgreSQL(connectionString);
});
```
- Complete event sourcing with stateful receptors
- Time travel debugging
- Perspective rebuilding from ledger

## Message Execution Patterns

Within any mode, Whizbang supports three execution patterns:

### Inline Mode

Receptor executes **synchronously** within the caller's transaction:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Execution-Patterns, Inline, Synchronous]
description: Inline execution pattern with synchronous receptor execution and perspective updates
---
var @event = await dispatcher.Send(new PlaceOrder(...));
// Receptor executed, events appended, perspectives updated—all before returning
```

Best for:
- Strong consistency requirements
- Simple CRUD operations
- Local development

### Async Mode

Receptor executes **asynchronously** in a background worker:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Execution-Patterns, Async, Background-Processing]
description: Async execution pattern with background worker processing
---
await dispatcher.Publish(new PlaceOrder(...));
// Command written to queue, returns immediately
// Receptor executes in background worker
```

Best for:
- High throughput
- Non-blocking operations
- Eventual consistency scenarios

### Batched Mode

Multiple messages **batched together** for efficiency:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Execution-Patterns, Batched, Performance]
description: Batched execution pattern for improved throughput with multiple commands
---
await dispatcher.PublishBatch(new[] {
    new PlaceOrder(...),
    new PlaceOrder(...),
    new PlaceOrder(...)
});
// All three commands processed in one batch for better throughput
```

Best for:
- Bulk imports
- Scheduled jobs
- Data migration

**The same receptor code works in all three modes.** Toggle via configuration, not code changes.

## Next Steps

Now that you understand the overall architecture, dive into:

- [**Core Concepts**](/docs/core-concepts/receptors) - Deep dive into Receptors, Perspectives, and Lenses
- [**Package Structure**](./package-structure.md) - Which NuGet packages to install
- [**Getting Started**](./getting-started.md) - Build your first Whizbang application
