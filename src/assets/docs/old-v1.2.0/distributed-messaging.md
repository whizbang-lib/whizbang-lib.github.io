---
title: Distributed Messaging
category: Roadmap
status: planned
target_version: 1.0.0
order: 1
unreleased: true
tags: microservices, messaging, kafka, distributed-systems
---

# Distributed Messaging

⚠️ **FUTURE FEATURE - NOT YET RELEASED**

This documentation describes distributed messaging support planned for v1.0.0.
This feature is not available in the current release.

**Status**: Planned
**Target Version**: 1.0.0

---

## Overview

Distributed messaging enables Whizbang applications to scale beyond a single process into microservices architecture. Commands and events can be routed across service boundaries using message brokers like Kafka, RabbitMQ, or Azure Service Bus.

## Key Features

### Domain Ownership Routing

Commands are **routed to the service that owns the domain**:

```csharp
// In the API Gateway service
await whizbang.Send(new PlaceOrder(...));
// ↓
// Command automatically routed to Orders service via message broker
```

Events are **broadcast from the owning domain** to all subscribers:

```csharp
// In the Orders service
await repository.SaveAsync(order);  // Emits OrderPlaced event
// ↓
// Event published to message broker
// ↓
// Inventory, Shipping, and Analytics services all receive the event
```

### Outbox/Inbox Pattern

Ensures **exactly-once semantics** for distributed messaging:

**Outbox** (publishing side):
- Events written to outbox table in same transaction as event store append
- Background worker publishes from outbox to message broker
- Messages marked as published after broker confirms

**Inbox** (subscribing side):
- Messages received from broker stored in inbox table
- Idempotent handler checks if message ID already processed
- Periodic cleanup of old inbox entries

### Message Broker Adapters

Multiple message broker adapters will be supported:

- **Kafka** - High throughput, event replay, partition awareness
- **RabbitMQ** - Flexible routing, priority queues
- **Azure Service Bus** - Managed service, sessions, duplicate detection
- **AWS SQS/SNS** - Managed service, FIFO queues

### Configuration

Intended API:

```csharp{
title: "Distributed Messaging Configuration"
description: "How distributed messaging will be configured"
framework: "NET8"
category: "Distributed Systems"
difficulty: "ADVANCED"
tags: ["Messaging", "Configuration", "Microservices"]
nugetPackages: ["Whizbang.Core", "Whizbang.Messaging", "Whizbang.Kafka"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

var services = new ServiceCollection();

services.AddWhizbang(options => {
    options.UseMessaging(msg => {
        // Configure domain ownership
        msg.UseDomainOwnership(domains => {
            domains.RegisterDomain("Orders", "https://orders.myapp.com");
            domains.RegisterDomain("Inventory", "https://inventory.myapp.com");
            domains.RegisterDomain("Shipping", "https://shipping.myapp.com");
        });

        // Use Kafka as message broker
        msg.UseKafka(kafka => {
            kafka.BootstrapServers = "kafka:9092";
            kafka.ConsumerGroup = "orders-service";
        });

        // Enable outbox for reliable publishing
        msg.UseOutbox(outbox => {
            outbox.PublishInterval = TimeSpan.FromSeconds(1);
        });

        // Enable inbox for idempotent consumption
        msg.UseInbox(inbox => {
            inbox.CleanupRetention = TimeSpan.FromDays(7);
        });
    });
});
```

## Backfilling Projections

When a new service subscribes to events for the first time, it can **backfill from the entire event history**:

```csharp{
title: "Projection Backfilling"
description: "Subscribe to events and backfill from history"
framework: "NET8"
category: "Distributed Systems"
difficulty: "ADVANCED"
tags: ["Projections", "Backfilling", "Event Sourcing"]
nugetPackages: ["Whizbang.Core", "Whizbang.EventSourcing", "Whizbang.Projections", "Whizbang.Messaging"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection", "System"]
showLineNumbers: true
}
using System;
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseProjections(proj => {
        proj.RegisterProjection<OrderAnalyticsProjection>(p => {
            // Subscribe to events from Orders domain
            p.Subscribe<OrderPlaced>();
            p.Subscribe<OrderShipped>();
            p.Subscribe<OrderCancelled>();

            // Backfill from the beginning of time
            p.BackfillFrom = DateTimeOffset.MinValue;

            // Query Orders service for historical events
            p.BackfillSource = "https://orders.myapp.com/events";
        });
    });
});
```

The projection engine will:
1. Query the Orders service's event store via HTTP API
2. Fetch all historical events matching subscribed types
3. Apply them to the projection in order
4. Switch to real-time message broker consumption
5. Continue processing new events as they arrive

## Feedback Welcome

We're designing this feature now and welcome your input!

- What message brokers do you need supported?
- What edge cases should we handle?
- What API would be most intuitive?

[Open a discussion](https://github.com/whizbang-lib/whizbang/discussions) to share your thoughts!
