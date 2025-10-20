---
title: Architecture Overview
category: Architecture & Design
order: 1
tags: architecture, design, system-design
---

# Architecture Overview

Whizbang is built on a layered architecture that supports scaling from a simple in-process mediator to a full distributed event-sourced system.

## Architectural Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                       │
│  (Your Domain Code: Aggregates, Projections, Handlers)      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Whizbang Runtime                          │
│  • Message Routing        • Event Sourcing Engine            │
│  • Command Handling       • Projection Management            │
│  • Event Publishing       • Saga Coordination                │
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

### 1. Message Router

The **Message Router** is the heart of Whizbang. It:

- Routes **commands** to their owning domain's handlers
- Publishes **events** to all interested subscribers
- Executes **queries** against projections
- Coordinates **sagas** across long-running processes

All message routing respects **domain ownership**—commands must be sent to the service that owns that aggregate, while events are broadcast from the owning domain to subscribers.

### 2. Event Store

The **Event Store** is the source of truth for all state changes. It:

- Appends events to immutable streams (one stream per aggregate)
- Supports **time-based queries** (get all events before/after a timestamp)
- Enables **backfilling** new projections from historical events
- Provides **global ordering** for cross-aggregate event streams
- Implements **optimistic concurrency** for aggregate updates

The Event Store is **driver-based**, supporting:
- Postgres (JSONB + sequential IDs)
- SQL Server (JSON columns + IDENTITY)
- MySQL (JSON columns + auto-increment)
- Cosmos DB (native event streams)
- LiteFS/SQLite (binary codec for edge deployments)

### 3. Projection Engine

The **Projection Engine** builds read models from event streams. It:

- Subscribes to event streams (local or from remote services)
- Applies events to projection handlers in order
- Tracks **checkpoint positions** to resume after restarts
- Supports **parallel processing** across partitions
- Handles **schema migrations** for evolving projections

Projections can be:
- **Inline** - Updated synchronously within the same transaction as event append
- **Async** - Updated in background workers for eventual consistency
- **Cached** - Materialized in-memory for ultra-low latency
- **External** - Pushed to Elasticsearch, Redis, or other specialized stores

### 4. Command & Event Pipeline

The **Pipeline** provides hooks for cross-cutting concerns:

```
Incoming Message
      ↓
  Validation
      ↓
  Authorization
      ↓
  Idempotence Check
      ↓
  OpenTelemetry Trace
      ↓
  Handler Execution
      ↓
  Event Append / Projection Update
      ↓
  Outbox Write (if distributed)
      ↓
  Response / New Messages
```

Every stage is **pluggable** and **observable**.

### 5. Saga Coordinator

**Sagas** orchestrate long-running processes across multiple aggregates or services. Whizbang supports two saga styles:

**Orchestration** - A central coordinator issues commands and listens for events:

```csharp
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

Sagas are persisted as event streams and can be replayed or debugged like any other aggregate.

### 6. Outbox/Inbox Pattern

For **distributed messaging**, Whizbang implements the Outbox/Inbox pattern to ensure exactly-once delivery:

**Outbox** (Publishing Service):
1. Handler executes and appends events to event store
2. Events also written to **outbox table** in same transaction
3. Background worker publishes outbox messages to message broker
4. Messages marked as published after broker confirms

**Inbox** (Subscribing Service):
1. Message arrives from broker
2. Stored in **inbox table** with unique message ID
3. If message ID exists (duplicate), skip processing
4. Otherwise, process handler and mark message as complete
5. Periodic cleanup of old inbox entries

This pattern guarantees **at-least-once delivery** from the broker combined with **idempotent handling** for exactly-once semantics.

## Domain Ownership Model

Whizbang enforces **explicit domain ownership** to prevent distributed system chaos.

### Commands

Commands are **sent TO** the service that owns the aggregate:

```csharp
[OwnedBy("Orders")]  // This command belongs to the Orders service
public record PlaceOrder(Guid OrderId, Guid CustomerId, List<OrderItem> Items);
```

When you send a command:
- In a **monolith**, it's routed to the local handler
- In **microservices**, it's routed to the Orders service via the message broker

### Events

Events are **emitted FROM** the service that owns the domain:

```csharp
[OwnedBy("Orders")]  // This event comes from the Orders service
public record OrderPlaced(Guid OrderId, Guid CustomerId, DateTimeOffset PlacedAt);
```

Other services can subscribe to `OrderPlaced` events:
- In a **monolith**, subscribers get events via in-process pub/sub
- In **microservices**, subscribers get events from the message broker topic

### Backfilling Projections

When a new service subscribes to events for the first time, it can **backfill from the beginning**:

```csharp
services.AddProjection<OrderHistoryProjection>(options => {
    options.Subscribe<OrderPlaced>();
    options.Subscribe<OrderShipped>();
    options.BackfillFrom = DateTimeOffset.MinValue;  // Start from the beginning
});
```

The projection engine will:
1. Query the Orders service's event store for all historical events
2. Apply them to the projection in order
3. Continue processing new events as they arrive

This allows new projections to be built from existing event history.

## Scaling Patterns

### Single Process (Mediator Mode)

```
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
- Monolithic applications
- Local development
- Simple CQRS without microservices

### Multi-Service (Distributed)

```
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
- Has its own event store for **database isolation**
- Publishes events to the shared message broker
- Subscribes to events from other services
- Routes commands to owning services

### Multi-Region (Disaster Recovery)

```
        Region 1                         Region 2
┌─────────────────────┐         ┌─────────────────────┐
│  Primary Services   │         │  Replica Services   │
│                     │         │                     │
│  Event Stores       │◄───────►│  Event Stores       │
│  (Postgres)         │  Sync   │  (Postgres)         │
└─────────────────────┘         └─────────────────────┘
         ↓                               ↓
┌─────────────────────┐         ┌─────────────────────┐
│  Kafka Cluster      │◄───────►│  Kafka Cluster      │
│  (Region 1)         │  Mirror │  (Region 2)         │
└─────────────────────┘         └─────────────────────┘
```

Event streams are replicated across regions for disaster recovery. Region 2 can take over if Region 1 fails.

## Message Execution Modes

Whizbang supports three execution modes, all using the same handler code:

### Inline Mode

Handler executes **synchronously** within the caller's transaction:

```csharp
var result = await whizbang.Send(new PlaceOrder(...));
// Handler executed, events appended, projections updated—all before returning
```

Best for:
- Strong consistency requirements
- Simple CRUD operations
- Local development

### Durable Mode

Handler executes **asynchronously** in a background worker:

```csharp
await whizbang.Publish(new PlaceOrder(...));
// Command written to queue, returns immediately
// Handler executes in background worker
```

Best for:
- High throughput
- Non-blocking operations
- Eventual consistency scenarios

### Batched Mode

Multiple messages **batched together** for efficiency:

```csharp
await whizbang.PublishBatch(new[] {
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

**The same handler code works in all three modes.** Toggle via configuration, not code changes.

## Next Steps

Now that you understand the overall architecture, dive into:

- [**Core Concepts**](./core-concepts.md) - Deep dive into Events, Commands, Aggregates, Projections
- [**Package Structure**](./package-structure.md) - Which NuGet packages to install
- [**Getting Started**](./getting-started.md) - Build your first Whizbang application
