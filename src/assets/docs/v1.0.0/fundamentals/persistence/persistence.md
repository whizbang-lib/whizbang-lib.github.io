---
title: Persistence
pageType: overview
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Core Concepts
order: 12
description: >-
  Configure how events are persisted by receptors using persistence modes and
  per-receptor strategies for optimal throughput, consistency, and reliability.
tags: 'persistence, event-sourcing, batching, outbox, configuration'
codeReferences:
  - src/Whizbang.Core/Persistence/PersistenceMode.cs
  - src/Whizbang.Core/Attributes/PersistenceStrategyAttribute.cs
  - src/Whizbang.Core/Messaging/IEventStore.cs
testReferences:
  - tests/Whizbang.Core.Tests/Persistence/PersistenceModeTests.cs
  - tests/Whizbang.Core.Tests/Persistence/PersistenceStrategyTests.cs
lastMaintainedCommit: '01f07906'
---

# Persistence

Whizbang provides flexible persistence strategies for event sourcing, allowing you to optimize for throughput, consistency, or reliability based on your specific use case.

:::updated
**Shipped surface (verified against library commit `1b31f58d`)**: the `PersistenceMode` enum and the `[PersistenceStrategy]` attribute exist exactly as documented below and are locked by tests (`PersistenceModeTests`, `PersistenceStrategyTests`) — but at this commit they are **declarative metadata only**. No runtime component reads the attribute yet, the `Whizbang:Persistence` configuration section shown on this page (`DefaultMode`, the `Batched`/`Outbox` option blocks, named `Strategies`) is not bound or consumed by the library, and `IEventStore` exposes **no `FlushAsync`** member. Events persist through the event-store/outbox pipeline regardless of the declared mode. The mode semantics and configuration shapes below describe the intended behavior documented in the enum's own XML docs.
:::

## Overview

Different receptors may have different requirements for how events are persisted:

- **Critical operations** need immediate consistency
- **High-throughput ingestion** benefits from batching
- **Cross-service coordination** requires reliable delivery

Whizbang addresses these needs through configurable persistence modes that can be set globally or per-receptor.

## Persistence Modes {#modes}

The `PersistenceMode` enum defines three built-in strategies:

```csharp{title="Persistence Modes" description="The PersistenceMode enum defines three built-in strategies:" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Persistence", "C#", "Modes"] tests=["PersistenceModeTests.PersistenceMode_HasThreeValuesAsync", "PersistenceModeTests.PersistenceMode_Immediate_HasCorrectIntValueAsync", "PersistenceModeTests.PersistenceMode_Batched_HasCorrectIntValueAsync", "PersistenceModeTests.PersistenceMode_Outbox_HasCorrectIntValueAsync", "PersistenceModeTests.PersistenceMode_Immediate_IsDefaultAsync"]}
public enum PersistenceMode {
  Immediate = 0,  // Default - commit after each append
  Batched = 1,    // Buffer and commit on flush/threshold
  Outbox = 2      // Queue for reliable delivery
}
```

### Immediate Mode (Default)

Events are committed immediately after each `AppendAsync` call.

```csharp{title="Immediate Mode (Default)" description="Events are committed immediately after each AppendAsync call." category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Persistence", "Immediate", "Mode"] unverified="illustrates immediate-commit runtime behavior which is declarative-only per the page callout — no runtime test; the Immediate=default enum value is verified on the Persistence Modes block"}
// Events committed immediately - no explicit SaveChanges needed
await _eventStore.AppendAsync(orderId, new OrderCreated(...));
// Event is now visible to all readers
```

**Best for**: Critical business operations requiring immediate consistency

**Trade-off**: Lower throughput due to per-event commits

**Use cases**:
- Financial transactions
- Order processing
- Inventory updates
- Any operation where immediate visibility is required

### Batched Mode

Events are buffered and committed when `FlushAsync` is called or when a configured batch threshold is reached.

```csharp{title="Batched Mode" description="Events are buffered and committed when FlushAsync is called or when a configured batch threshold is reached." category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Persistence", "Batched", "Mode"] unverified="design-intent snippet — batched buffering/flush is declarative-only (no FlushAsync exists yet), not exercised by this page's tests"}
// Design intent (see callout above — IEventStore has no FlushAsync yet):
// events are buffered ...
await _eventStore.AppendAsync(streamId1, event1);
await _eventStore.AppendAsync(streamId2, event2);
await _eventStore.AppendAsync(streamId3, event3);

// ... then committed as one batch on flush / threshold.
// Today, use AppendBatchAsync for multi-append in one call:
await _eventStore.AppendBatchAsync(entries);
```

**Best for**: High-throughput event ingestion scenarios

**Trade-off**: Events not visible until flush; potential data loss on crash before flush

**Use cases**:
- Bulk data imports
- Log ingestion
- Analytics event collection
- Batch processing pipelines

**Configuration** (appsettings.json):

```json{title="Batched Mode (2)" description="Configuration (appsettings." category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Persistence", "Batched", "Mode"]}
{
  "Whizbang": {
    "Persistence": {
      "Batched": {
        "BatchSize": 100,
        "FlushIntervalMs": 1000
      }
    }
  }
}
```

### Outbox Mode

Events are queued for reliable delivery via `IWorkCoordinator`, ensuring at-least-once delivery with automatic retries.

```csharp{title="Outbox Mode" description="Events are queued for reliable delivery via IWorkCoordinator, ensuring at-least-once delivery with automatic retries." category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Persistence", "Outbox", "Mode"] unverified="illustrates outbox-mode runtime delivery which is declarative-only per the page callout — not exercised by this page's tests"}
// Event queued to outbox table, processed reliably by worker
await _eventStore.AppendAsync(orderId, new OrderCreated(...));
// Event will be delivered even if this process crashes
```

**Best for**: Cross-service coordination, integration events

**Trade-off**: Higher latency due to outbox pattern overhead

**Use cases**:
- Publishing events to message brokers
- Cross-service communication
- Integration with external systems
- Any scenario requiring guaranteed delivery

---

## Per-Receptor Strategy {#per-receptor-strategy}

Use the `[PersistenceStrategy]` attribute to configure persistence behavior per-receptor, overriding the global default.

### Using Built-in Modes

```csharp{title="Using Built-in Modes" description="Using Built-in Modes" category="Implementation" difficulty="ADVANCED" tags=["Fundamentals", "Persistence", "Using", "Built-in"] tests=["PersistenceStrategyTests.PersistenceStrategyAttribute_CanBeAppliedToReceptorAsync", "PersistenceStrategyTests.PersistenceStrategyAttribute_Mode_CanBeSetViaConstructorAsync", "PersistenceStrategyTests.PersistenceStrategyAttribute_AttributeUsage_AllowsClassTargetAsync"]}
using Whizbang.Core.Attributes;
using Whizbang.Core.Persistence;

// Use immediate mode for critical operations
[PersistenceStrategy(PersistenceMode.Immediate)]
public class ProcessPaymentReceptor : IReceptor<ProcessPayment, PaymentProcessed> {
  public async ValueTask<PaymentProcessed> HandleAsync(
      ProcessPayment message,
      CancellationToken ct = default) {
    // Payment events committed immediately
    return new PaymentProcessed(message.PaymentId, DateTimeOffset.UtcNow);
  }
}

// Use batched mode for high-throughput ingestion
[PersistenceStrategy(PersistenceMode.Batched)]
public class IngestAnalyticsReceptor : IReceptor<IngestAnalytics, AnalyticsIngested> {
  public async ValueTask<AnalyticsIngested> HandleAsync(
      IngestAnalytics message,
      CancellationToken ct = default) {
    // Events buffered for batch commit
    return new AnalyticsIngested(message.EventId);
  }
}

// Use outbox mode for reliable cross-service events
[PersistenceStrategy(PersistenceMode.Outbox)]
public class NotifyExternalSystemReceptor : IReceptor<NotifyExternal, ExternalNotified> {
  public async ValueTask<ExternalNotified> HandleAsync(
      NotifyExternal message,
      CancellationToken ct = default) {
    // Event queued for reliable delivery
    return new ExternalNotified(message.NotificationId);
  }
}
```

### Using Custom Named Strategies

For more control, define custom strategies in `appsettings.json` and reference them by name:

```json{title="Using Custom Named Strategies" description="For more control, define custom strategies in `appsettings." category="Implementation" difficulty="ADVANCED" tags=["Fundamentals", "Persistence", "Using", "Custom"]}
{
  "Whizbang": {
    "Persistence": {
      "DefaultMode": "Immediate",
      "Strategies": {
        "high-throughput-batch": {
          "Mode": "Batched",
          "BatchSize": 500,
          "FlushIntervalMs": 250
        },
        "critical-outbox": {
          "Mode": "Outbox",
          "RetryCount": 5,
          "RetryDelayMs": 1000
        }
      }
    }
  }
}
```

```csharp{title="Using Custom Named Strategies - BulkImportReceptor" description="For more control, define custom strategies in `appsettings." category="Implementation" difficulty="ADVANCED" tags=["Fundamentals", "Persistence", "Using", "Custom"] tests=["PersistenceStrategyTests.PersistenceStrategyAttribute_CanBeAppliedWithCustomStrategyAsync", "PersistenceStrategyTests.PersistenceStrategyAttribute_StrategyName_CanBeSetViaConstructorAsync", "PersistenceStrategyTests.PersistenceStrategyAttribute_Mode_IsNullWhenUsingStrategyNameAsync"]}
// Reference custom strategy by name
[PersistenceStrategy("high-throughput-batch")]
public class BulkImportReceptor : IReceptor<ImportData, DataImported> {
  public async ValueTask<DataImported> HandleAsync(
      ImportData message,
      CancellationToken ct = default) {
    // Uses custom batch settings: 500 events, 250ms flush interval
    return new DataImported(message.BatchId, message.RecordCount);
  }
}

[PersistenceStrategy("critical-outbox")]
public class PublishIntegrationEventReceptor : IReceptor<PublishEvent, EventPublished> {
  public async ValueTask<EventPublished> HandleAsync(
      PublishEvent message,
      CancellationToken ct = default) {
    // Uses custom outbox settings: 5 retries, 1s delay
    return new EventPublished(message.EventId);
  }
}
```

### Default Behavior (No Attribute)

Receptors without the `[PersistenceStrategy]` attribute use the global default configured in `appsettings.json`:

```csharp{title="Default Behavior (No Attribute)" description="Receptors without the [PersistenceStrategy] attribute use the global default configured in `appsettings." category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Persistence", "Default", "Behavior"] tests=["PersistenceStrategyTests.PersistenceStrategyAttribute_NotPresentOnDefaultReceptorAsync", "PersistenceStrategyTests.PersistenceMode_DefaultIsImmediateDetachedAsync"]}
// No attribute = uses Persistence.DefaultMode (Immediate if not configured)
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
  public async ValueTask<OrderCreated> HandleAsync(
      CreateOrder message,
      CancellationToken ct = default) {
    return new OrderCreated(Guid.CreateVersion7(), message.CustomerId);
  }
}
```

---

## Global Configuration

Configure default persistence behavior in `appsettings.json`:

```json{title="Global Configuration" description="Configure default persistence behavior in `appsettings." category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Persistence", "Global", "Configuration"]}
{
  "Whizbang": {
    "Persistence": {
      "DefaultMode": "Immediate",
      "Batched": {
        "BatchSize": 100,
        "FlushIntervalMs": 1000,
        "MaxBufferSize": 10000
      },
      "Outbox": {
        "PollIntervalMs": 100,
        "BatchSize": 50,
        "RetryCount": 3,
        "RetryDelayMs": 1000,
        "MaxRetryDelayMs": 60000
      }
    }
  }
}
```

### Configuration Options

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `DefaultMode` | `string` | `"Immediate"` | Default mode when no attribute specified |
| `Batched.BatchSize` | `int` | `100` | Events per batch before auto-flush |
| `Batched.FlushIntervalMs` | `int` | `1000` | Max time before auto-flush |
| `Batched.MaxBufferSize` | `int` | `10000` | Max buffered events before blocking |
| `Outbox.PollIntervalMs` | `int` | `100` | How often to check for pending events |
| `Outbox.BatchSize` | `int` | `50` | Events processed per poll |
| `Outbox.RetryCount` | `int` | `3` | Max delivery attempts |
| `Outbox.RetryDelayMs` | `int` | `1000` | Initial delay between retries |
| `Outbox.MaxRetryDelayMs` | `int` | `60000` | Max delay (exponential backoff) |

---

## Attribute Details

The `PersistenceStrategyAttribute` supports two constructors:

```csharp{title="Attribute Details" description="The PersistenceStrategyAttribute supports two constructors:" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Persistence", "Attribute", "Details"] tests=["PersistenceStrategyTests.PersistenceStrategyAttribute_Mode_CanBeSetViaConstructorAsync", "PersistenceStrategyTests.PersistenceStrategyAttribute_StrategyName_CanBeSetViaConstructorAsync", "PersistenceStrategyTests.PersistenceStrategyAttribute_StrategyName_IsNullWhenUsingModeAsync", "PersistenceStrategyTests.PersistenceStrategyAttribute_Mode_IsNullWhenUsingStrategyNameAsync"]}
// Use built-in mode
[PersistenceStrategy(PersistenceMode.Batched)]

// Use named custom strategy
[PersistenceStrategy("high-throughput-batch")]
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `Mode` | `PersistenceMode?` | The persistence mode (null if using named strategy) |
| `StrategyName` | `string?` | The custom strategy name (null if using built-in mode) |

### Attribute Behavior

- **Target**: Class only (`AttributeTargets.Class`)
- **Multiple**: Not allowed (`AllowMultiple = false`)
- **Inherited**: Yes (`Inherited = true`) - base class strategy applies to derived classes

```csharp{title="Attribute Behavior" description="- Target: Class only (`AttributeTargets." category="Implementation" difficulty="ADVANCED" tags=["Fundamentals", "Persistence", "Attribute", "Behavior"] tests=["PersistenceStrategyTests.PersistenceStrategyAttribute_AttributeUsage_AllowsInheritedAsync", "PersistenceStrategyTests.PersistenceStrategyAttribute_AttributeUsage_AllowsClassTargetAsync", "PersistenceStrategyTests.PersistenceStrategyAttribute_AttributeUsage_DoesNotAllowMultipleAsync"]}
// Base class strategy inherited by derived classes
[PersistenceStrategy(PersistenceMode.Batched)]
public abstract class BaseBatchReceptor<TMessage, TResponse>
    : IReceptor<TMessage, TResponse> where TMessage : notnull {
  // ...
}

// Inherits Batched mode from base class
public class ImportUsersReceptor : BaseBatchReceptor<ImportUsers, UsersImported> {
  // ...
}
```

---

## Choosing the Right Mode

| Requirement | Recommended Mode |
|-------------|------------------|
| Immediate consistency needed | `Immediate` |
| Financial/payment processing | `Immediate` |
| High-volume event ingestion | `Batched` |
| Bulk data imports | `Batched` |
| Cross-service events | `Outbox` |
| Integration with external systems | `Outbox` |
| Message broker publishing | `Outbox` |
| General business operations | `Immediate` (default) |

### Decision Flow

1. **Does the event need immediate visibility?** Use `Immediate`
2. **Is this high-throughput ingestion?** Use `Batched`
3. **Must the event be delivered reliably to external systems?** Use `Outbox`
4. **Not sure?** Start with `Immediate` (safest default)

---

## Related Documentation

- [Event Store](../../data/event-store.md) - Core event storage interface
- [Receptors](../receptors/receptors.md) - Message handlers that produce events
- [Work Coordinator](../../messaging/work-coordinator.md) - Background processing for outbox
- [Outbox Pattern](../../messaging/outbox-pattern.md) - Reliable event publishing details

### For Contributors

Looking to extend the persistence layer? See:
- [Database Schema Framework](../../extending/extensibility/database-schema-framework.md) — Build custom database schema management and migration strategies

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
