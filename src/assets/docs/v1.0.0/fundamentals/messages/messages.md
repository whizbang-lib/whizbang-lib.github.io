---
title: Messages
version: 1.0.0
category: Core Concepts
order: 5
description: >-
  IMessage interface - the base marker interface for all message types in Whizbang.
tags: 'messages, commands, events, queries, marker-interface'
codeReferences:
  - src/Whizbang.Core/IMessage.cs
  - src/Whizbang.Core/ICommand.cs
  - src/Whizbang.Core/IEvent.cs
---

# Messages

The `IMessage` interface is the foundation of Whizbang's messaging system. All message types - commands, events, and queries - derive from this marker interface.

## Overview

Messages are the **data carriers** in Whizbang applications. They represent:

- **Commands**: Intentions to change state (e.g., `CreateOrder`)
- **Events**: Facts about state changes (e.g., `OrderCreated`)
- **Queries**: Requests for information (e.g., `GetOrderDetails`)

## IMessage Interface {#imessage}

```csharp{title="IMessage Interface" description="Demonstrates iMessage Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "IMessage", "Interface"]}
namespace Whizbang.Core;

/// <summary>
/// Marker interface for all messages in the system (commands, events, queries, etc.).
/// Used for generic constraints and type safety in receptors, dispatchers, and lifecycle systems.
/// </summary>
/// <remarks>
/// This interface serves as the base for all message types:
/// <list type="bullet">
/// <item><description>ICommand - Messages that represent intentions to change state</description></item>
/// <item><description>IEvent - Messages that represent facts about state changes</description></item>
/// <item><description>Custom message types - Any application-specific message</description></item>
/// </list>
/// </remarks>
public interface IMessage {
  // Marker interface - no members required
}
```

## Message Type Hierarchy

```
IMessage (marker interface)
├── ICommand (intentions to change state)
│   ├── CreateOrder
│   ├── UpdateInventory
│   └── ProcessPayment
├── IEvent (facts about state changes)
│   ├── OrderCreated
│   ├── InventoryUpdated
│   └── PaymentProcessed
└── Custom Messages
    └── Application-specific types
```

## Defining Messages

### Commands

Commands represent **intentions** - requests to perform actions:

```csharp{title="Commands" description="Commands represent intentions - requests to perform actions:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Commands"]}
public record CreateOrder : ICommand {
  public required Guid CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
  public string? CouponCode { get; init; }
}

public record CancelOrder : ICommand {
  public required Guid OrderId { get; init; }
  public required string Reason { get; init; }
}
```

### Events

Events represent **facts** - things that have happened:

```csharp{title="Events" description="Events represent facts - things that have happened:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Events"]}
public record OrderCreated : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }
  public required Guid CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
  public required decimal Total { get; init; }
  public required DateTimeOffset CreatedAt { get; init; }
}

public record OrderCancelled : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }
  public required string Reason { get; init; }
  public required DateTimeOffset CancelledAt { get; init; }
}
```

## Message Design Guidelines

### Use Records for Immutability

```csharp{title="Use Records for Immutability" description="Demonstrates use Records for Immutability" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Records", "Immutability"]}
// ✅ GOOD: Immutable record with init-only properties
public record CreateOrder : ICommand {
  public required Guid CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
}

// ❌ BAD: Mutable class with setters
public class CreateOrder : ICommand {
  public Guid CustomerId { get; set; }  // Mutable!
  public OrderItem[] Items { get; set; }
}
```

### Make Messages Self-Contained

```csharp{title="Make Messages Self-Contained" description="Demonstrates make Messages Self-Contained" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Make", "Self-Contained"]}
// ✅ GOOD: All data needed to process the command
public record CreateOrder : ICommand {
  public required Guid CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
  public required Address ShippingAddress { get; init; }
  public string? CouponCode { get; init; }
}

// ❌ BAD: Missing data, requires external lookups
public record CreateOrder : ICommand {
  public required Guid CustomerId { get; init; }
  // Where do items and shipping come from?
}
```

### Use Value Objects for Type Safety

```csharp{title="Use Value Objects for Type Safety" description="Demonstrates use Value Objects for Type Safety" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Value", "Objects"]}
// ✅ GOOD: Type-safe value objects
public record CreateOrder : ICommand {
  public required CustomerId CustomerId { get; init; }  // Strongly-typed
  public required OrderItem[] Items { get; init; }
}

// ❌ BAD: Primitive obsession
public record CreateOrder : ICommand {
  public required string CustomerId { get; init; }  // What format?
}
```

## Message Constraints

`IMessage` enables generic constraints throughout Whizbang:

```csharp{title="Message Constraints" description="IMessage enables generic constraints throughout Whizbang:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Message", "Constraints"]}
// Receptors handle specific message types
public interface IReceptor<TMessage, TResponse>
    where TMessage : notnull {

  ValueTask<TResponse> HandleAsync(TMessage message, CancellationToken ct = default);
}

// Dispatcher accepts any message type
public interface IDispatcher {
  Task<TResponse> LocalInvokeAsync<TMessage, TResponse>(
      TMessage message,
      CancellationToken ct = default)
      where TMessage : notnull;
}
```

## Message Flow

```
[Client/API]
    |
    v
[Command: CreateOrder]
    |
    v
[Dispatcher] ----> [Receptor] ----> [Event: OrderCreated]
                                           |
                                           v
                                    [Perspectives]
                                           |
                                           v
                                    [Read Models]
```

1. Client sends a **Command**
2. Dispatcher routes to appropriate **Receptor**
3. Receptor processes command, returns **Event**
4. Event is published to **Perspectives**
5. Perspectives update **Read Models**

## Message Envelopes

Messages are wrapped in envelopes for routing and tracing:

```csharp{title="Message Envelopes" description="Messages are wrapped in envelopes for routing and tracing:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Message", "Envelopes"]}
// Message payload is wrapped in an envelope
var envelope = MessageEnvelope.Create(
    messageId: MessageId.New(),
    correlationId: correlationId,
    causationId: causationId,
    payload: message,
    hops: []
);
```

See [Message Envelopes](../../messaging/message-envelopes.md) for details.

## Best Practices

### Naming Conventions

**Commands** use imperative verbs:
- `CreateOrder`, `UpdateProfile`, `ProcessPayment`

**Events** use past tense:
- `OrderCreated`, `ProfileUpdated`, `PaymentProcessed`

### Single Responsibility

Each message should represent **one** logical operation:

```csharp{title="Single Responsibility" description="Each message should represent one logical operation:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Single", "Responsibility"]}
// ✅ GOOD: Specific commands
public record CreateOrder : ICommand { ... }
public record UpdateOrderAddress : ICommand { ... }
public record AddOrderItem : ICommand { ... }

// ❌ BAD: Generic catch-all
public record ModifyOrder : ICommand {
  public string Operation { get; init; }  // "create", "update", "delete"?
}
```

### Event Data Completeness

Events should capture **all relevant state**:

```csharp{title="Event Data Completeness" description="Events should capture all relevant state:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Event", "Data"]}
// ✅ GOOD: Complete state snapshot
public record ProductPriceChanged : IEvent {
  [StreamKey]
  public required Guid ProductId { get; init; }
  public required decimal OldPrice { get; init; }  // Before
  public required decimal NewPrice { get; init; }  // After
  public required DateTimeOffset ChangedAt { get; init; }
  public required string ChangedBy { get; init; }
}

// ❌ BAD: Incomplete - can't reconstruct history
public record ProductPriceChanged : IEvent {
  public required Guid ProductId { get; init; }
  public required decimal NewPrice { get; init; }
  // Missing: old price, when, by whom
}
```

## Related Documentation

- [Commands and Events](../../messaging/commands-events.md) - Detailed command/event patterns
- [Message Envelopes](../../messaging/message-envelopes.md) - Envelope structure
- [Receptors](../receptors/receptors.md) - Message handlers
- [Dispatcher](../dispatcher/dispatcher.md) - Message routing

---

*Version 1.0.0 - Foundation Release*
