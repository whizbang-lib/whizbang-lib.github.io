---
title: "Perspective Discovery"
version: 0.1.0
category: Source Generators
order: 2
description: "Compile-time perspective discovery for event-driven read models - zero reflection registration and Event Store integration"
tags: source-generators, perspectives, read-models, events, roslyn, compile-time, zero-reflection
codeReferences:
  - src/Whizbang.Generators/PerspectiveDiscoveryGenerator.cs
  - src/Whizbang.Generators/Templates/PerspectiveRegistrationsTemplate.cs
---

# Perspective Discovery

The **PerspectiveDiscoveryGenerator** discovers all `IPerspectiveOf<TEvent>` implementations at compile-time and generates zero-reflection DI registration code. Perspectives are event-driven read models that update denormalized views in response to domain events.

## Perspectives vs Receptors

| Aspect | Perspectives | Receptors |
|--------|-------------|----------|
| **Purpose** | Update read models | Handle commands/queries |
| **Trigger** | Domain events | Commands/queries |
| **Return** | void (async Task) | Typed response |
| **Pattern** | Event-driven denormalization | Command/query handling |
| **Invocation** | Via Event Store coordinator | Via Dispatcher |
| **Use Case** | Build query-optimized views | Implement business logic |

**Whizbang Pattern**: Commands → Receptors → Events → Perspectives → Read Models

---

## Event-Driven Read Models

### Traditional Approach (Direct Updates)

```csharp
// ❌ Tight coupling between command and query models
public class OrderService {
    public async Task<OrderCreated> CreateOrderAsync(CreateOrder command) {
        // 1. Update write model
        var order = new Order(command.CustomerId, command.Items);
        await _context.Orders.AddAsync(order);

        // 2. Update read model (tightly coupled!)
        var summary = new OrderSummary {
            OrderId = order.Id,
            CustomerId = order.CustomerId,
            Total = order.Total,
            Status = "Created"
        };
        await _context.OrderSummaries.AddAsync(summary);

        await _context.SaveChangesAsync();

        return new OrderCreated(/* ... */);
    }
}
```

### Whizbang Approach (Event-Driven)

```csharp
// ✅ Decoupled: Command handler publishes event, perspective updates read model
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public async ValueTask<OrderCreated> HandleAsync(CreateOrder message, CancellationToken ct) {
        // 1. Business logic (write model)
        var order = new Order(message.CustomerId, message.Items);

        // 2. Return event (no direct coupling to read model!)
        return new OrderCreated(
            OrderId: order.Id,
            CustomerId: message.CustomerId,
            Total: order.Total,
            CreatedAt: DateTimeOffset.UtcNow
        );
    }
}

// ✅ Perspective updates read model independently
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        await conn.ExecuteAsync(
            """
            INSERT INTO order_summaries (order_id, customer_id, total, status, created_at)
            VALUES (@OrderId, @CustomerId, @Total, 'Created', @CreatedAt)
            """,
            @event,
            cancellationToken: ct
        );
    }
}
```

**Benefits**:
- ✅ **Decoupling**: Command handler doesn't know about read models
- ✅ **Multiple Perspectives**: Many read models from same event
- ✅ **Independent Evolution**: Change read models without touching commands
- ✅ **Rebuild Capability**: Replay events to rebuild read models

---

## How It Works

### 1. Compile-Time Discovery

```
┌──────────────────────────────────────────────────┐
│  Your Code                                       │
│                                                  │
│  public class OrderSummaryPerspective           │
│      : IPerspectiveOf<OrderCreated> {           │
│    public async Task UpdateAsync(               │
│        OrderCreated @event,                     │
│        CancellationToken ct) { ... }            │
│  }                                               │
└─────────────────┬────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────┐
│  PerspectiveDiscoveryGenerator (Roslyn)         │
│                                                  │
│  1. Scan syntax tree for classes                │
│  2. Filter classes with base types              │
│  3. Check for IPerspectiveOf<TEvent>            │
│  4. Extract: Class, Event types (can be many!)  │
└─────────────────┬────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────┐
│  Generated Code                                  │
│                                                  │
│  PerspectiveRegistrations.g.cs                  │
│  └─ services.AddScoped<IPerspectiveOf<...>>()  │
└──────────────────────────────────────────────────┘
```

### 2. Generated File

**PerspectiveRegistrations.g.cs**:
```csharp
using Microsoft.Extensions.DependencyInjection;
using Whizbang.Core;

namespace MyApp.Generated;

public static class PerspectiveRegistrations {
    /// <summary>
    /// Registers all discovered perspectives (5 perspective classes, 8 event handlers).
    /// Generated at compile-time by PerspectiveDiscoveryGenerator.
    /// </summary>
    public static IServiceCollection AddWhizbangPerspectives(
        this IServiceCollection services) {

        // OrderSummaryPerspective handles 3 events
        services.AddScoped<IPerspectiveOf<OrderCreated>, OrderSummaryPerspective>();
        services.AddScoped<IPerspectiveOf<OrderShipped>, OrderSummaryPerspective>();
        services.AddScoped<IPerspectiveOf<OrderCancelled>, OrderSummaryPerspective>();

        // CustomerStatisticsPerspective handles 2 events
        services.AddScoped<IPerspectiveOf<OrderCreated>, CustomerStatisticsPerspective>();
        services.AddScoped<IPerspectiveOf<OrderShipped>, CustomerStatisticsPerspective>();

        // InventoryPerspective handles 3 events
        services.AddScoped<IPerspectiveOf<OrderCreated>, InventoryPerspective>();
        services.AddScoped<IPerspectiveOf<OrderShipped>, InventoryPerspective>();
        services.AddScoped<IPerspectiveOf<OrderCancelled>, InventoryPerspective>();

        return services;
    }
}
```

**Key Observations**:
- One perspective class can handle **multiple events** (e.g., OrderSummaryPerspective handles 3 events)
- Multiple perspectives can handle the **same event** (e.g., OrderCreated handled by 3 perspectives)
- Registered as **Scoped** (new instance per request/worker batch)

---

## Using Generated Registration

### Registration in Program.cs

```csharp
// Program.cs
using MyApp.Generated;

var builder = WebApplication.CreateBuilder(args);

// Register perspectives (generated method)
builder.Services.AddWhizbangPerspectives();

// Register Event Store coordinator (triggers perspectives)
builder.Services.AddWhizbangEventStore(/* config */);

var app = builder.Build();
app.Run();
```

**That's it!** No manual registration, no reflection, no assembly scanning.

---

## Perspective Patterns

### Pattern 1: Single Event Handler

```csharp
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        await conn.ExecuteAsync(
            """
            INSERT INTO order_summaries (
                order_id, customer_id, total, status, created_at
            ) VALUES (
                @OrderId, @CustomerId, @Total, 'Created', @CreatedAt
            )
            """,
            @event,
            cancellationToken: ct
        );
    }
}
```

**Generated registration** (1 event):
```csharp
services.AddScoped<IPerspectiveOf<OrderCreated>, OrderSummaryPerspective>();
```

---

### Pattern 2: Multiple Event Handlers

```csharp
public class OrderSummaryPerspective :
    IPerspectiveOf<OrderCreated>,
    IPerspectiveOf<OrderShipped>,
    IPerspectiveOf<OrderCancelled> {

    private readonly IDbConnectionFactory _db;

    // Handle OrderCreated
    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "INSERT INTO order_summaries (...) VALUES (...)",
            @event,
            cancellationToken: ct
        );
    }

    // Handle OrderShipped
    public async Task UpdateAsync(OrderShipped @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE order_summaries SET status = 'Shipped', shipped_at = @ShippedAt WHERE order_id = @OrderId",
            @event,
            cancellationToken: ct
        );
    }

    // Handle OrderCancelled
    public async Task UpdateAsync(OrderCancelled @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE order_summaries SET status = 'Cancelled', cancelled_at = @CancelledAt WHERE order_id = @OrderId",
            @event,
            cancellationToken: ct
        );
    }
}
```

**Generated registration** (3 events):
```csharp
services.AddScoped<IPerspectiveOf<OrderCreated>, OrderSummaryPerspective>();
services.AddScoped<IPerspectiveOf<OrderShipped>, OrderSummaryPerspective>();
services.AddScoped<IPerspectiveOf<OrderCancelled>, OrderSummaryPerspective>();
```

**Benefits**:
- Single perspective class for related updates
- Maintains cohesion (all order summary logic in one place)
- Generator handles multiple interface implementations automatically

---

### Pattern 3: Aggregated Statistics

```csharp
public class CustomerStatisticsPerspective :
    IPerspectiveOf<OrderCreated>,
    IPerspectiveOf<OrderShipped> {

    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        // Increment order count and total spent
        await conn.ExecuteAsync(
            """
            INSERT INTO customer_statistics (customer_id, total_orders, total_spent, last_order_at)
            VALUES (@CustomerId, 1, @Total, @CreatedAt)
            ON CONFLICT (customer_id) DO UPDATE SET
                total_orders = customer_statistics.total_orders + 1,
                total_spent = customer_statistics.total_spent + @Total,
                last_order_at = @CreatedAt
            """,
            new { @event.CustomerId, @event.Total, @event.CreatedAt },
            cancellationToken: ct
        );
    }

    public async Task UpdateAsync(OrderShipped @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        // Update last shipped date
        await conn.ExecuteAsync(
            """
            UPDATE customer_statistics
            SET last_shipped_at = @ShippedAt
            WHERE customer_id = @CustomerId
            """,
            new { @event.CustomerId, @event.ShippedAt },
            cancellationToken: ct
        );
    }
}
```

**Use Case**: Pre-compute aggregations for analytics dashboards.

---

## Event Store Integration

### Perspective Invocation Flow

```
1. Receptor handles command, returns event
   └─> OrderCreated event

2. Event published to Event Store
   └─> Stored in wh_events table

3. Event Store Coordinator processes event
   └─> Resolves IPerspectiveOf<OrderCreated> implementations

4. Perspectives invoked (parallel)
   ├─> OrderSummaryPerspective.UpdateAsync(OrderCreated)
   ├─> CustomerStatisticsPerspective.UpdateAsync(OrderCreated)
   └─> InventoryPerspective.UpdateAsync(OrderCreated)

5. Checkpoints updated
   └─> wh_perspective_checkpoints table
```

### Checkpoint-Based Processing

Each perspective tracks **last processed event** per stream:

```sql
-- wh_perspective_checkpoints table
CREATE TABLE wh_perspective_checkpoints (
    stream_id UUID NOT NULL,
    perspective_name VARCHAR(200) NOT NULL,
    last_event_id UUID NOT NULL,
    last_sequence_number BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (stream_id, perspective_name)
);
```

**Example**:
```
stream_id                           | perspective_name           | last_event_id | last_sequence_number
------------------------------------|----------------------------|---------------|---------------------
order-abc-123                       | OrderSummaryPerspective    | event-001     | 5
order-abc-123                       | CustomerStatistics         | event-001     | 5
order-abc-123                       | InventoryPerspective       | event-001     | 5
```

**Benefit**: Can rebuild perspectives from any checkpoint (time-travel!).

---

## Rebuilding Perspectives

### Full Rebuild

```csharp
public class PerspectiveRebuilder {
    private readonly IEventStore _eventStore;
    private readonly IServiceProvider _services;

    public async Task RebuildAllPerspectivesAsync(CancellationToken ct = default) {
        // 1. Truncate all perspective tables
        await TruncatePerspectiveTables();

        // 2. Reset checkpoints
        await ResetCheckpoints();

        // 3. Read all events from Event Store
        var events = await _eventStore.ReadAllEventsAsync(fromSequence: 0);

        // 4. Resolve all perspectives
        var perspectives = GetAllPerspectives();

        // 5. Replay events through perspectives
        foreach (var @event in events) {
            foreach (var perspective in perspectives) {
                if (CanHandle(perspective, @event)) {
                    await perspective.UpdateAsync(@event, ct);
                }
            }
        }
    }

    private IEnumerable<IPerspectiveOf<object>> GetAllPerspectives() {
        // Generator registers all perspectives, we can resolve them here
        return _services.GetServices<IPerspectiveOf<OrderCreated>>()
            .Concat(_services.GetServices<IPerspectiveOf<OrderShipped>>())
            .Concat(_services.GetServices<IPerspectiveOf<OrderCancelled>>())
            .Cast<IPerspectiveOf<object>>();
    }
}
```

**Use Cases**:
- Add new perspective to existing system
- Fix bug in perspective logic
- Schema migration (add new columns)
- Analytics: "What would customer stats look like without refunds?"

---

## Generator Performance

### Incremental Caching

Like ReceptorDiscoveryGenerator, uses **value-based caching**:

```csharp
internal sealed record PerspectiveInfo(
    string ClassName,
    string[] EventTypes  // Arrays support value equality in records!
);
```

**Performance**:
```
First compilation:
├─ Scan syntax tree: 50ms
├─ Extract perspective info: 20ms
├─ Generate registration file: 5ms
└─ Total: 75ms

Subsequent compilation (no changes):
├─ Check cache: 1ms (inputs unchanged)
├─ Skip generation: 0ms
└─ Total: 1ms (74ms saved!)
```

### Syntactic Filtering

```csharp
// Fast syntactic check (no semantic model access)
predicate: static (node, _) => node is ClassDeclarationSyntax { BaseList.Types.Count: > 0 },

// Only runs on ~5% of nodes (those with base types)
transform: static (ctx, ct) => ExtractPerspectiveInfo(ctx, ct)
```

**Result**: 100x faster than analyzing every node!

---

## Debugging Generated Code

### View Generated File

Generated file written to:
```
obj/Debug/net10.0/generated/Whizbang.Generators/PerspectiveDiscoveryGenerator/
└── PerspectiveRegistrations.g.cs
```

Or configured output:
```xml
<PropertyGroup>
  <EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
  <CompilerGeneratedFilesOutputPath>.whizbang-generated</CompilerGeneratedFilesOutputPath>
</PropertyGroup>
```

### Build Diagnostics

Generator reports discoveries:

```
Build started...
info WHIZ003: Found perspective 'OrderSummaryPerspective' handling OrderCreated, OrderShipped, OrderCancelled
info WHIZ003: Found perspective 'CustomerStatisticsPerspective' handling OrderCreated, OrderShipped
info WHIZ003: Found perspective 'InventoryPerspective' handling OrderCreated, OrderShipped, OrderCancelled
Build succeeded.
    3 perspectives discovered (8 event handlers)
```

---

## Diagnostics

### WHIZ003: Perspective Discovered

**Severity**: Info

**Message**: `Found perspective '{0}' handling {1}`

**Example**:
```
info WHIZ003: Found perspective 'OrderSummaryPerspective' handling OrderCreated, OrderShipped, OrderCancelled
```

**When**: Reported for each discovered perspective during compilation.

**Args**:
- `{0}`: Perspective class name (e.g., OrderSummaryPerspective)
- `{1}`: Comma-separated event types (e.g., OrderCreated, OrderShipped, OrderCancelled)

---

## Multiple Perspectives Per Event

**One event, many read models**:

```csharp
// Event
public record OrderCreated(
    Guid OrderId,
    Guid CustomerId,
    decimal Total,
    DateTimeOffset CreatedAt
);

// Perspective 1: Order summary view
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct) {
        // Update order_summaries table
    }
}

// Perspective 2: Customer statistics
public class CustomerStatisticsPerspective : IPerspectiveOf<OrderCreated> {
    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct) {
        // Update customer_statistics table (aggregate)
    }
}

// Perspective 3: Inventory reservation
public class InventoryPerspective : IPerspectiveOf<OrderCreated> {
    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct) {
        // Update inventory table (decrement available)
    }
}
```

**Generator registers all three**:
```csharp
services.AddScoped<IPerspectiveOf<OrderCreated>, OrderSummaryPerspective>();
services.AddScoped<IPerspectiveOf<OrderCreated>, CustomerStatisticsPerspective>();
services.AddScoped<IPerspectiveOf<OrderCreated>, InventoryPerspective>();
```

**Event Store Coordinator invokes all in parallel** (or configurable sequential).

---

## AOT Compatibility

### Zero Reflection Guarantee

Generated registration uses **no reflection**:

```csharp
// ✅ Direct type registration (AOT-compatible)
services.AddScoped<IPerspectiveOf<OrderCreated>, OrderSummaryPerspective>();

// ❌ Reflection-based registration (incompatible with AOT)
var perspectiveType = typeof(IPerspectiveOf<>).MakeGenericType(eventType);
var implementationType = assembly.GetTypes().First(t => t.IsAssignableTo(perspectiveType));
services.AddScoped(perspectiveType, implementationType);
```

### Native AOT Verification

```xml
<PropertyGroup>
  <PublishAot>true</PublishAot>
</PropertyGroup>
```

**Build output**:
```
dotnet publish -c Release
...
Generating native code
  MyApp.dll -> MyApp.exe (Native AOT)
  Startup time: < 10ms
  Perspectives registered: 5 classes, 8 event handlers
```

---

## Best Practices

### DO ✅

- ✅ **Implement IPerspectiveOf<TEvent>** for each event your read model needs
- ✅ **Group related updates** in one perspective class (e.g., OrderSummaryPerspective)
- ✅ **Use UPSERT** for idempotency (ON CONFLICT DO UPDATE)
- ✅ **Keep perspectives simple** (no complex business logic)
- ✅ **Use Dapper** for high-performance reads/writes
- ✅ **Design for rebuild** (assume events can be replayed)
- ✅ **Call AddWhizbangPerspectives()** in Program.cs

### DON'T ❌

- ❌ Put business logic in perspectives (belong in receptors)
- ❌ Query other services in perspectives (use denormalized data from event)
- ❌ Forget idempotency (events can be replayed!)
- ❌ Use EF Core for perspectives (Dapper is 20x faster)
- ❌ Manually register perspectives (generator handles this)
- ❌ Modify generated files (will be overwritten)

---

## Troubleshooting

### Problem: Perspective Not Invoked

**Symptoms**: Event published but perspective's `UpdateAsync` never called.

**Causes**:
1. Perspective not implementing `IPerspectiveOf<TEvent>` correctly
2. Missing `AddWhizbangPerspectives()` call
3. Event type mismatch (spelling, namespace)

**Solution**:
```csharp
// ✅ Correct interface implementation
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct) {
        // Implementation
    }
}

// Program.cs
builder.Services.AddWhizbangPerspectives();  // Required!
```

### Problem: Duplicate Perspective Updates

**Symptoms**: Same event processed multiple times by perspective.

**Causes**:
1. Missing checkpoint tracking
2. Event Store replaying events without checking checkpoints

**Solution**: Use `IWorkCoordinator.ProcessWorkBatchAsync` with perspective checkpoint tracking:

```csharp
await _coordinator.ProcessWorkBatchAsync(
    /* ... */,
    perspectiveCompletions: new[] {
        new PerspectiveCheckpointCompletion {
            StreamId = @event.StreamId,
            PerspectiveName = nameof(OrderSummaryPerspective),
            LastEventId = @event.EventId,
            Status = PerspectiveProcessingStatus.UpToDate
        }
    },
    /* ... */
);
```

### Problem: Generator Doesn't Find Perspectives

**Symptoms**: `PerspectiveRegistrations.g.cs` not generated or empty.

**Causes**:
1. No perspectives in project
2. Perspectives are abstract classes (can't be instantiated)

**Solution**:
```csharp
// ✅ Concrete class
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    // Implementation
}

// ❌ Abstract class (skipped by generator)
public abstract class BasePerspective : IPerspectiveOf<OrderCreated> {
    // Abstract classes can't be instantiated
}
```

---

## Further Reading

**Source Generators**:
- [Receptor Discovery](receptor-discovery.md) - Compile-time receptor discovery
- [Message Registry](message-registry.md) - VSCode extension integration
- [Aggregate IDs](aggregate-ids.md) - UUIDv7 generation for identity value objects
- [JSON Contexts](json-contexts.md) - AOT-compatible JSON serialization

**Core Concepts**:
- [Perspectives](../core-concepts/perspectives.md) - Event-driven read models
- [Lenses](../core-concepts/lenses.md) - Query-optimized repositories

**Data Access**:
- [Perspectives Storage](../data/perspectives-storage.md) - Read model schema design
- [Event Store](../data/event-store.md) - Event sourcing and replay

**Messaging**:
- [Work Coordinator](../messaging/work-coordinator.md) - Atomic batch processing

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
