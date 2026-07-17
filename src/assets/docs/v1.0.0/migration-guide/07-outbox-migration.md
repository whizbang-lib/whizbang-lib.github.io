---
title: Outbox Migration
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Migration Guide
order: 8
description: >-
  Migrating from Wolverine's durable outbox to Whizbang's built-in outbox
  pattern
tags: 'migration, outbox, inbox, durability, messaging'
codeReferences:
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinatorStrategy.cs
  - src/Whizbang.Core/Workers/WorkerPipelineExtensions.cs
  - src/Whizbang.Core/Workers/DeadLetterRecoveryWorker.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/FlushApiTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreWorkCoordinatorSchemaTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperWorkCoordinatorBroadTests.cs
lastMaintainedCommit: '01f07906'
---

# Outbox Migration: Wolverine → Whizbang

This guide covers migrating from Wolverine's durable outbox pattern to Whizbang's built-in outbox implementation.

## Understanding the Outbox Pattern

The outbox pattern ensures reliable message delivery by:

1. Writing events to a database table (outbox) in the same transaction as business data
2. A background worker reads from the outbox and publishes to the message broker
3. On successful publish, marks the outbox entry as completed

This guarantees **at-least-once delivery** even if the message broker is temporarily unavailable.

## Key Differences

| Aspect | Wolverine | Whizbang |
|--------|-----------|----------|
| Configuration | `UseDurableOutbox()` | Built-in, always enabled |
| Outbox table | `wolverine_outgoing_envelopes` | `wh_outbox` |
| Inbox table | `wolverine_incoming_envelopes` | `wh_inbox` |
| Background workers | Wolverine daemon | Registered automatically by `AddWhizbang()` (`OutboxPublishWorker`, `InboxDispatchWorker`, drain workers, etc.) |
| Batching/flush policy | Configurable | Configurable via `WorkCoordinatorOptions` (Immediate, Scoped, Interval, Batch strategies) |

## Wolverine Outbox Configuration

```csharp{title="Wolverine Outbox Configuration" description="Wolverine Outbox Configuration" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Wolverine", "Outbox", "Configuration"]}
// Wolverine: Explicit outbox configuration
builder.Host.UseWolverine(opts => {
    opts.UseRabbitMq(connectionString)
        .UseConventionalRouting()
        .UseDurableOutbox();  // Enable outbox

    opts.Policies.UseDurableLocalQueues();
    opts.Policies.UseDurableInbox();

    // Configure retry
    opts.Handlers.OnAnyException()
        .RetryWithCooldown(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(5))
        .Then.Requeue();
});
```

## Whizbang Outbox Configuration

Whizbang's outbox is **built-in and always enabled**. `AddWhizbang()` registers all background workers (outbox publishing, inbox dispatch, drain workers, dead-letter recovery) automatically — you never add hosted services yourself. Tune behavior through `WorkCoordinatorOptions`:

```csharp{title="Whizbang Outbox Configuration" description="Whizbang's outbox is built-in and always enabled." category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Whizbang", "Outbox", "Configuration"]}
builder.Services
    .AddWhizbang()
    .WithEFCore<AppDbContext>()
    .WithDriver.Postgres;

// Optional: tune the work coordinator (defaults shown)
builder.Services.Configure<WorkCoordinatorOptions>(options => {
    options.Strategy = WorkCoordinatorStrategy.Scoped;  // Immediate | Scoped | Interval | Batch
    options.IntervalMilliseconds = 100;                 // used when Strategy = Interval
    options.BatchSize = 100;                            // used when Strategy = Batch
    options.PartitionCount = 10_000;
    options.DebugMode = false;                          // true keeps completed rows for debugging
});
```

## Outbox Flow Comparison

### Wolverine Flow

```csharp{title="Wolverine Flow" description="Wolverine Flow" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Wolverine", "Flow"]}
// Wolverine: Messages queued to outbox automatically
[WolverineHandler]
public async Task<OrderCreated> Handle(
    CreateOrder command,
    IDocumentSession session,
    IMessageContext context) {

    var @event = new OrderCreated(command.OrderId);

    // Append event (transactional)
    session.Events.Append(command.OrderId, @event);

    // Queue message to outbox (same transaction)
    await context.PublishAsync(new NotifyCustomer(command.CustomerEmail));

    await session.SaveChangesAsync();  // Commits both
    return @event;
}
```

### Whizbang Flow

```csharp{title="Whizbang Flow" description="Whizbang Flow" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Whizbang", "Flow"]}
// Whizbang: Outbox is implicit - events returned from a receptor are
// automatically cascaded to the event store and outbox by the dispatcher.
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        // Returning the event is all that's needed:
        // the work coordinator persists it (wh_event_store + wh_outbox)
        // atomically, and the outbox workers publish it to the transport.
        return ValueTask.FromResult(new OrderCreated(message.OrderId));
    }
}

// To publish an additional side-effect message explicitly, use the dispatcher -
// it also goes through the outbox:
await _dispatcher.PublishAsync(new NotifyCustomer(customerEmail));

// Routing control is available via Route.* when you need it:
// Route.Outbox(@event), Route.Both(@event), Route.EventStoreOnly(@event), ...
```

## Inbox Pattern (Idempotency)

### Wolverine Inbox

```csharp{title="Wolverine Inbox" description="Wolverine Inbox" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Wolverine", "Inbox"]}
// Wolverine: Inbox for idempotent processing
opts.Policies.UseDurableInbox();

// Messages are tracked by ID in wolverine_incoming_envelopes
// Duplicate messages are automatically rejected
```

### Whizbang Inbox

```csharp{title="Whizbang Inbox" description="Whizbang Inbox" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Whizbang", "Inbox"]}
// Whizbang: Inbox deduplication is built-in - no configuration required.
// Messages received from the transport are recorded in wh_inbox and
// duplicates (same MessageId) are rejected before processing.

// Completed rows are deleted on completion; set DebugMode to keep them:
builder.Services.Configure<WorkCoordinatorOptions>(options => {
    options.DebugMode = true;  // keeps completed wh_inbox/wh_outbox rows for debugging
});
```

## Work Coordinator Strategies

The strategy controls how buffered work (outbox writes, completions) is flushed to the database. Select it via `WorkCoordinatorOptions.Strategy`:

| Strategy | Behavior | Best for |
|----------|----------|----------|
| `Immediate` | Flushes each operation immediately | Lowest latency, highest DB load |
| `Scoped` (default) | Batches within a scope (e.g., HTTP request), flushes on scope disposal | Balanced latency/efficiency |
| `Interval` | Batches and flushes on a timer (`IntervalMilliseconds`) | High-throughput background workers |
| `Batch` | Flushes at `BatchSize` or after a debounce quiet period | Bulk imports, seeding |

```csharp{title="Selecting a Strategy" description="Selecting a work coordinator strategy:" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Interval", "Strategy", "Default"]}
builder.Services.Configure<WorkCoordinatorOptions>(options => {
    options.Strategy = WorkCoordinatorStrategy.Interval;
    options.IntervalMilliseconds = 100;
    options.CoalesceWindowMilliseconds = 50;  // recommended for Interval strategy
});
```

Postgres `LISTEN`/`NOTIFY` wake-ups for new work are built into the Postgres drivers — there is no separate "notification strategy" to configure.

## Error Handling

### Wolverine Error Policies

```csharp{title="Wolverine Error Policies" description="Wolverine Error Policies" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Wolverine", "Error", "Policies"]}
opts.Handlers.OnAnyException()
    .RetryWithCooldown(
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(30))
    .Then.MoveToErrorQueue();
```

### Whizbang Retry Behavior

Retries are lease-based rather than policy-chain-based:

- Failed work is released back to the pool when its lease expires (`WorkCoordinatorOptions.LeaseSeconds`, default 300) and is picked up again automatically.
- Transports enforce `MaxDeliveryAttempts` (default 10 on both RabbitMQ and Azure Service Bus options) before dead-lettering a message.
- Rows that exhaust delivery move to the `wh_dead_letters` table, where `DeadLetterRecoveryWorker` applies the configured `IDeadLetterRecoveryPolicy` (re-emit, hold for review, or mark permanently failed).

```csharp{title="Whizbang Retry Configuration" description="Whizbang Retry Configuration" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Whizbang", "Retry", "Configuration"]}
builder.Services.Configure<WorkCoordinatorOptions>(options => {
    options.LeaseSeconds = 300;                          // lease before failed work is reclaimed
    options.AbandonStaleInstanceThresholdSeconds = 30;   // dead-instance detection
});

builder.Services.AddRabbitMQTransport(connectionString, options => {
    options.MaxDeliveryAttempts = 10;                    // then dead-letter
});
```

## Dead Letter Queue

### Wolverine Dead Letter

```csharp{title="Wolverine Dead Letter" description="Wolverine Dead Letter" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Wolverine", "Dead", "Letter"]}
// Wolverine moves failed messages to error queue
// Access via IMessageStore.Inbox.DeadLetterEnvelopes
```

### Whizbang Dead Letter

```sql{title="Whizbang Dead Letter" description="Whizbang Dead Letter" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "Sql", "Whizbang", "Dead", "Letter"]}
-- Failed messages are moved to the wh_dead_letters table.
-- Inspect them with SQL:
SELECT * FROM wh_dead_letters ORDER BY created_at DESC;
```

Recovery is automated: `DeadLetterRecoveryWorker` (registered by `AddWhizbang()`) periodically scans `wh_dead_letters`, applies the configured `IDeadLetterRecoveryPolicy`, and either re-emits rows to the source work table or marks them terminal (hold-for-review / permanently-failed). Transport-level DLQs (RabbitMQ dead-letter exchange, Service Bus DLQ subscriptions) are drained back into the pipeline by `TransportDeadLetterDrainWorker`.

## Database Schema

### Wolverine Tables

```sql{title="Wolverine Tables" description="Wolverine Tables" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "Sql", "Wolverine", "Tables"]}
-- Wolverine outbox tables
CREATE TABLE wolverine_outgoing_envelopes (...);
CREATE TABLE wolverine_incoming_envelopes (...);
```

### Whizbang Tables

```sql{title="Whizbang Tables" description="Whizbang Tables" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "Sql", "Whizbang", "Tables"]}
-- Whizbang provisions its own infrastructure tables on startup
-- (prefix "wh_"); you never create them by hand. The messaging set includes:
--   wh_outbox            -- outgoing messages awaiting publish (created_at timestamps)
--   wh_inbox             -- received messages for dedup/processing (received_at timestamps)
--   wh_event_store       -- append-only event streams
--   wh_dead_letters      -- messages that exhausted delivery
--   wh_active_streams    -- stream claim/ordering state
--   wh_service_instances -- instance heartbeat + partition assignment
```

> **Note**: Rows in `wh_outbox`/`wh_inbox` are deleted on successful completion in production. Enable `WorkCoordinatorOptions.DebugMode` to keep completed rows for debugging.

## Transactional Consistency

### Ensuring Atomicity

Atomicity is handled by the framework, not by user-managed transactions. When a receptor returns an event (or you dispatch through `IDispatcher`), the work coordinator persists the event-store row and the outbox row together in a single `process_work_batch` database call — there is no `IOutbox.EnqueueAsync` API to call and no transaction to manage:

```csharp{title="Ensuring Atomicity" description="Ensuring Atomicity" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Ensuring", "Atomicity"]}
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        // Event store write + outbox write happen atomically
        // in the work coordinator - no explicit transaction needed.
        return ValueTask.FromResult(new OrderCreated(message.OrderId));
    }
}
```

## Migration Checklist

- [ ] Remove `UseDurableOutbox()` configuration
- [ ] Remove `UseDurableInbox()` configuration
- [ ] Remove manual outbox enqueue calls (events returned from receptors cascade automatically)
- [ ] Optionally tune `WorkCoordinatorOptions` (strategy, lease, batch size)
- [ ] Set transport `MaxDeliveryAttempts` to match your old retry policy
- [ ] Verify Whizbang provisions its schema on startup (`wh_outbox`, `wh_inbox`, `wh_event_store`, `wh_dead_letters`)
- [ ] Review dead-letter recovery policy (`IDeadLetterRecoveryPolicy`)
- [ ] Test transactional consistency

---

*Previous: [Transport Configuration](06-transport-configuration.md) | Next: [Testing Migration](08-testing-migration.md)*
