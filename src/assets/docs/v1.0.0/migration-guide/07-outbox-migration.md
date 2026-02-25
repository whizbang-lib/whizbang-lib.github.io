---
title: Outbox Migration
version: 1.0.0
category: Migration Guide
order: 8
description: >-
  Migrating from Wolverine's durable outbox to Whizbang's built-in outbox
  pattern
tags: 'migration, outbox, inbox, durability, messaging'
codeReferences:
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
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
| Outbox table | `wolverine_outgoing_envelopes` | `whizbang.outbox` |
| Inbox table | `wolverine_incoming_envelopes` | `whizbang.inbox` |
| Background worker | Wolverine daemon | `WorkCoordinatorPublisherWorker` |
| Retry policy | Configurable | Configurable via `IWorkCoordinatorStrategy` |

## Wolverine Outbox Configuration

```csharp
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

Whizbang's outbox is **built-in and always enabled**. Configure the work coordinator for your needs:

```csharp
builder.Services.AddWhizbang(options => {
    options.UsePostgres(connectionString);
});

// Configure work coordinator strategy
builder.Services.AddSingleton<IWorkCoordinatorStrategy>(
    new IntervalWorkCoordinatorStrategy(
        pollInterval: TimeSpan.FromMilliseconds(100),
        batchSize: 100,
        maxRetries: 5,
        retryDelay: TimeSpan.FromSeconds(1)));

// Add the background worker
builder.Services.AddHostedService<WorkCoordinatorPublisherWorker>();
```

## Outbox Flow Comparison

### Wolverine Flow

```csharp
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

```csharp
// Whizbang: Outbox is implicit via dispatcher
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IEventStore _eventStore;
    private readonly IDispatcher _dispatcher;

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        var @event = new OrderCreated(message.OrderId);

        // Append event to event store
        var envelope = EnvelopeFactory.Create(@event);
        await _eventStore.AppendAsync(message.OrderId, envelope, ct);

        // Publish goes through outbox automatically
        await _dispatcher.PublishAsync(
            new NotifyCustomer(message.CustomerEmail),
            ct);

        return @event;
    }
}
```

## Inbox Pattern (Idempotency)

### Wolverine Inbox

```csharp
// Wolverine: Inbox for idempotent processing
opts.Policies.UseDurableInbox();

// Messages are tracked by ID in wolverine_incoming_envelopes
// Duplicate messages are automatically rejected
```

### Whizbang Inbox

```csharp
// Whizbang: Built-in inbox deduplication
builder.Services.AddWhizbang(options => {
    options.EnableInboxDeduplication(
        retentionPeriod: TimeSpan.FromDays(7),
        cleanupInterval: TimeSpan.FromHours(1));
});

// Messages with same MessageId are automatically deduplicated
// via whizbang.inbox table
```

## Work Coordinator Strategies

### Interval Strategy (Default)

Polls the outbox at regular intervals:

```csharp
builder.Services.AddSingleton<IWorkCoordinatorStrategy>(
    new IntervalWorkCoordinatorStrategy(
        pollInterval: TimeSpan.FromMilliseconds(100)));
```

### Notification Strategy

Uses database notifications for immediate processing:

```csharp
builder.Services.AddSingleton<IWorkCoordinatorStrategy>(
    new NotificationWorkCoordinatorStrategy(
        connectionString,
        channelName: "outbox_notify"));
```

### Hybrid Strategy

Combines notification with interval fallback:

```csharp
builder.Services.AddSingleton<IWorkCoordinatorStrategy>(
    new HybridWorkCoordinatorStrategy(
        notificationChannel: "outbox_notify",
        fallbackInterval: TimeSpan.FromSeconds(5)));
```

## Error Handling

### Wolverine Error Policies

```csharp
opts.Handlers.OnAnyException()
    .RetryWithCooldown(
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(30))
    .Then.MoveToErrorQueue();
```

### Whizbang Retry Configuration

```csharp
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

```csharp
// Wolverine moves failed messages to error queue
// Access via IMessageStore.Inbox.DeadLetterEnvelopes
```

### Whizbang Dead Letter

```csharp
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

```sql
-- Wolverine outbox tables
CREATE TABLE wolverine_outgoing_envelopes (...);
CREATE TABLE wolverine_incoming_envelopes (...);
```

### Whizbang Tables

```sql
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

```csharp
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
