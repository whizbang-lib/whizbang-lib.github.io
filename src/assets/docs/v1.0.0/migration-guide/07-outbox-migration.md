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

### Interval Strategy (Default)

Polls the outbox at regular intervals:

```csharp{title="Interval Strategy (Default)" description="Polls the outbox at regular intervals:" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Interval", "Strategy", "Default"]}
builder.Services.AddSingleton<IWorkCoordinatorStrategy>(
    new IntervalWorkCoordinatorStrategy(
        pollInterval: TimeSpan.FromMilliseconds(100)));
```

### Notification Strategy

Uses database notifications for immediate processing:

```csharp{title="Notification Strategy" description="Uses database notifications for immediate processing:" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Notification", "Strategy"]}
builder.Services.AddSingleton<IWorkCoordinatorStrategy>(
    new NotificationWorkCoordinatorStrategy(
        connectionString,
        channelName: "outbox_notify"));
```

### Hybrid Strategy

Combines notification with interval fallback:

```csharp{title="Hybrid Strategy" description="Combines notification with interval fallback:" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Hybrid", "Strategy"]}
builder.Services.AddSingleton<IWorkCoordinatorStrategy>(
    new HybridWorkCoordinatorStrategy(
        notificationChannel: "outbox_notify",
        fallbackInterval: TimeSpan.FromSeconds(5)));
```

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

### Whizbang Retry Configuration

```csharp{title="Whizbang Retry Configuration" description="Whizbang Retry Configuration" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Whizbang", "Retry", "Configuration"]}
builder.Services.AddSingleton<IWorkCoordinatorStrategy>(
    new IntervalWorkCoordinatorStrategy(
        pollInterval: TimeSpan.FromMilliseconds(100),
        batchSize: 100,
        maxRetries: 5,
        retryDelays: new[] {
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(30)
        },
        onMaxRetriesExceeded: OutboxAction.MoveToDeadLetter));
```

## Dead Letter Queue

### Wolverine Dead Letter

```csharp{title="Wolverine Dead Letter" description="Wolverine Dead Letter" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Wolverine", "Dead", "Letter"]}
// Wolverine moves failed messages to error queue
// Access via IMessageStore.Inbox.DeadLetterEnvelopes
```

### Whizbang Dead Letter

```csharp{title="Whizbang Dead Letter" description="Whizbang Dead Letter" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Whizbang", "Dead", "Letter"]}
// Failed messages moved to whizbang.dead_letters table
// Query via:
var deadLetters = await _dbContext.DeadLetters
    .Where(d => d.CreatedAt > cutoff)
    .ToListAsync();

// Replay dead letter
await _workCoordinator.ReplayDeadLetterAsync(deadLetterId, ct);
```

## Database Schema

### Wolverine Tables

```sql{title="Wolverine Tables" description="Wolverine Tables" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "Sql", "Wolverine", "Tables"]}
-- Wolverine outbox tables
CREATE TABLE wolverine_outgoing_envelopes (...);
CREATE TABLE wolverine_incoming_envelopes (...);
```

### Whizbang Tables

```sql{title="Whizbang Tables" description="Whizbang Tables" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "Sql", "Whizbang", "Tables"]}
-- Whizbang outbox tables
CREATE TABLE whizbang.outbox (
    id uuid PRIMARY KEY,
    message_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    scheduled_at timestamptz,
    attempts int DEFAULT 0,
    last_error text,
    completed_at timestamptz
);

CREATE TABLE whizbang.inbox (
    message_id uuid PRIMARY KEY,
    received_at timestamptz NOT NULL
);

CREATE TABLE whizbang.dead_letters (
    id uuid PRIMARY KEY,
    original_id uuid NOT NULL,
    message_type text NOT NULL,
    payload jsonb NOT NULL,
    error text NOT NULL,
    created_at timestamptz NOT NULL
);
```

## Transactional Consistency

### Ensuring Atomicity

```csharp{title="Ensuring Atomicity" description="Ensuring Atomicity" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Ensuring", "Atomicity"]}
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IEventStore _eventStore;
    private readonly IOutbox _outbox;
    private readonly AppDbContext _dbContext;

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        // All operations in same transaction
        await using var transaction = await _dbContext.Database
            .BeginTransactionAsync(ct);

        try {
            // 1. Append event
            var @event = new OrderCreated(message.OrderId);
            await _eventStore.AppendAsync(message.OrderId,
                EnvelopeFactory.Create(@event), ct);

            // 2. Write to outbox (same transaction)
            await _outbox.EnqueueAsync(
                new NotifyCustomer(message.CustomerEmail),
                ct);

            // 3. Commit together
            await transaction.CommitAsync(ct);

            return @event;
        } catch {
            await transaction.RollbackAsync(ct);
            throw;
        }
    }
}
```

## Migration Checklist

- [ ] Remove `UseDurableOutbox()` configuration
- [ ] Remove `UseDurableInbox()` configuration
- [ ] Configure `IWorkCoordinatorStrategy`
- [ ] Add `WorkCoordinatorPublisherWorker` hosted service
- [ ] Update retry policies to Whizbang format
- [ ] Initialize Whizbang schema (includes outbox tables)
- [ ] Update dead letter handling
- [ ] Test transactional consistency

---

*Previous: [Transport Configuration](06-transport-configuration.md) | Next: [Testing Migration](08-testing-migration.md)*
