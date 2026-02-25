---
title: Lifecycle Receptors
version: 1.0.0
category: Core Concepts
order: 10
description: >-
  Complete API reference for lifecycle receptors - [FireAt] attribute,
  ILifecycleContext injection, compile-time vs runtime registration, and
  AOT-compatible patterns
tags: >-
  lifecycle, receptors, FireAt, attributes, ILifecycleContext, AOT,
  source-generators
codeReferences:
  - src/Whizbang.Core/Messaging/FireAtAttribute.cs
  - src/Whizbang.Core/Messaging/ILifecycleContext.cs
  - src/Whizbang.Core/Messaging/ILifecycleReceptorRegistry.cs
  - src/Whizbang.Core/Messaging/IReceptorInvoker.cs
  - src/Whizbang.Core/Messaging/IReceptorRegistry.cs
  - src/Whizbang.Core/Messaging/ReceptorInvoker.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
---

# Lifecycle Receptors

Lifecycle receptors are **regular receptors** that execute at specific stages in the message processing pipeline. Using the `[FireAt]` attribute, you can declaratively control when your receptors fire without changing any code.

## Core Concept

**Lifecycle receptors reuse the existing `IReceptor<TMessage>` interface** - no new interfaces to learn. The `[FireAt]` attribute controls timing:

```csharp
// Regular receptor - fires at default stages (see below)
public class CreateTenantHandler : IReceptor<CreateTenantCommand, TenantCreatedEvent> {
  public ValueTask<TenantCreatedEvent> HandleAsync(CreateTenantCommand cmd, CancellationToken ct) {
    // Business logic fires at:
    // - LocalImmediateInline (local path)
    // - PreOutboxInline (distributed sender)
    // - PostInboxInline (distributed receiver)
    return ValueTask.FromResult(new TenantCreatedEvent(Guid.NewGuid()));
  }
}

// Lifecycle receptor - fires ONLY at PostPerspectiveAsync
[FireAt(LifecycleStage.PostPerspectiveAsync)]
public class ProductMetricsReceptor : IReceptor<ProductCreatedEvent> {
  public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // Track metrics AFTER perspective completes
    // Does NOT fire at default stages!
    return ValueTask.CompletedTask;
  }
}
```

**Key Design**:
- Reuse existing `IReceptor<TMessage>` interface
- `[FireAt]` attribute controls when receptor executes
- Receptors without `[FireAt]` fire at **default stages** (LocalImmediateInline, PreOutboxInline, PostInboxInline)
- Adding `[FireAt]` **replaces** defaults - receptor fires ONLY at specified stages
- Can apply multiple `[FireAt]` attributes to fire at multiple stages
- Optional `ILifecycleContext` injection for metadata access
- **Scoped dependency support** - receptors can inject scoped services like `DbContext`, `IOrchestratorAgent`

---

## Scoped Dependency Support

:::new
Scoped dependency support added in v1.0.0
:::

Lifecycle receptors can inject **scoped dependencies** just like regular receptors. The generated code creates a new `IServiceScope` for each lifecycle invocation, ensuring proper dependency resolution and lifecycle management.

### Example with Scoped Dependencies

```csharp
[FireAt(LifecycleStage.PostDistributeInline)]
public class StartupHandler : IReceptor<StartedEvent> {
  private readonly AppDbContext _dbContext;        // Scoped!
  private readonly IOrchestratorAgent _agent;      // Scoped!
  private readonly ILogger<StartupHandler> _logger; // Transient

  public StartupHandler(
      AppDbContext dbContext,
      IOrchestratorAgent agent,
      ILogger<StartupHandler> logger) {
    _dbContext = dbContext;
    _agent = agent;
    _logger = logger;
  }

  public async ValueTask HandleAsync(StartedEvent evt, CancellationToken ct) {
    // All scoped dependencies work correctly!
    var config = await _dbContext.Configurations.FirstAsync(ct);
    await _agent.StartOrchestratorAsync(config, ct);
    _logger.LogInformation("Orchestrator started");
  }
}
```

### How It Works

The generated `LifecycleInvoker` uses `IServiceScopeFactory` to create a scope per invocation:

```csharp
// Generated code pattern
if (messageType == typeof(StartedEvent) && stage == LifecycleStage.PostDistributeInline) {
  using var scope = _scopeFactory.CreateScope();
  var receptor = scope.ServiceProvider.GetRequiredService<IReceptor<StartedEvent>>();
  await receptor.HandleAsync((StartedEvent)message, cancellationToken);
}
// Scope disposed after invocation - resources cleaned up
```

**Benefits**:
- ✅ Same scoped dependency support as regular receptors
- ✅ Proper scope lifecycle (created before, disposed after each invocation)
- ✅ Compatible with `DbContext`, `IOrchestratorAgent`, and other scoped services
- ✅ No special configuration required

---

## The `[FireAt]` Attribute

### Basic Usage

Apply `[FireAt]` to receptor classes to control execution timing:

```csharp
using Whizbang.Core;
using Whizbang.Core.Observability;

[FireAt(LifecycleStage.PostPerspectiveAsync)]
public class EventMetricsReceptor : IReceptor<ProductCreatedEvent> {
  private readonly IMetricsCollector _metrics;

  public EventMetricsReceptor(IMetricsCollector metrics) {
    _metrics = metrics;
  }

  public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    _metrics.RecordEvent("ProductCreated", evt.ProductId);
    return ValueTask.CompletedTask;
  }
}
```

**Attribute Properties**:
- **Stage** (required) - The `LifecycleStage` when receptor should fire

**Allowed Targets**:
- Classes implementing `IReceptor<TMessage>`
- Can be applied multiple times (see below)
- Not inherited (Inherited = false)

---

### Multiple Stages (Multiple Attributes)

Apply `[FireAt]` multiple times to fire at multiple stages:

```csharp
// Fire at BOTH PreOutbox and PostOutbox stages
[FireAt(LifecycleStage.PreOutboxInline)]
[FireAt(LifecycleStage.PostOutboxAsync)]
public class OutboxMonitoringReceptor : IReceptor<IEvent> {
  private readonly ILogger<OutboxMonitoringReceptor> _logger;
  private readonly Stopwatch _timer = new();

  public ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    // Check which stage we're at (optional - via ILifecycleContext)
    if (_timer.IsRunning) {
      // PostOutbox - measure publish duration
      _logger.LogInformation("Published {EventType} in {Ms}ms",
        evt.GetType().Name, _timer.ElapsedMilliseconds);
      _timer.Reset();
    } else {
      // PreOutbox - start timing
      _timer.Start();
    }
    return ValueTask.CompletedTask;
  }
}
```

**Use Cases for Multiple Stages**:
- Measure operation duration (PreX + PostX)
- Before/after validation
- Consistent logging across multiple stages
- Cross-cutting concerns (auditing, metrics)

---

### Default Behavior (No Attribute)

:::updated
Default behavior changed in v1.0.0 to support the unified receptor invocation model.
:::

Receptors **without `[FireAt]` fire at default stages** based on the dispatch path:

| Path | Default Stage | When |
|------|--------------|------|
| **Local** | `LocalImmediateInline` | `DispatchAsync(msg, local: true)` |
| **Distributed (Sender)** | `PreOutboxInline` | Before publishing to transport |
| **Distributed (Receiver)** | `PostInboxInline` | After receiving from transport |

```csharp
// No [FireAt] attribute = fires at default stages
public class CreateProductReceptor : IReceptor<CreateProductCommand, ProductCreatedEvent> {
  public async ValueTask<ProductCreatedEvent> HandleAsync(
      CreateProductCommand cmd,
      CancellationToken ct) {

    // This executes at:
    // - LocalImmediateInline (when local: true)
    // - PreOutboxInline (distributed sender)
    // - PostInboxInline (distributed receiver)
    var product = new Product(cmd.Name, cmd.Price);
    await _dbContext.Products.AddAsync(product, ct);

    return new ProductCreatedEvent(product.Id, product.Name);
  }
}
```

**Why these defaults?**
- **Paths are mutually exclusive** - a message goes local OR distributed, not both
- **Default receptors "just work"** regardless of how message is dispatched
- **Adding `[FireAt]` opts OUT of defaults** - you control exactly when receptor fires:

```csharp
// ONLY fires locally, never on distributed path
[FireAt(LifecycleStage.LocalImmediateInline)]
public class LocalOnlyHandler : IReceptor<SomeCommand> { }

// ONLY fires on receiver, never on sender or local
[FireAt(LifecycleStage.PostInboxInline)]
public class ReceiverOnlyHandler : IReceptor<SomeEvent> { }

// Fires on BOTH sender AND receiver (but not local)
[FireAt(LifecycleStage.PreOutboxInline)]
[FireAt(LifecycleStage.PostInboxInline)]
public class DistributedOnlyHandler : IReceptor<SomeEvent> { }
```

---

## Optional `ILifecycleContext` Injection

Receptors can optionally inject `ILifecycleContext` to access metadata about the current invocation:

### Interface Definition

```csharp
public interface ILifecycleContext {
  /// <summary>The lifecycle stage currently executing</summary>
  LifecycleStage CurrentStage { get; }

  /// <summary>The ID of the event being processed (null for commands)</summary>
  Guid? EventId { get; }

  /// <summary>The stream ID (aggregate ID) for event-sourced messages</summary>
  Guid? StreamId { get; }

  /// <summary>The perspective name processing this message (null if not perspective stage)</summary>
  string? PerspectiveName { get; }

  /// <summary>The last processed event ID for the perspective (checkpoint position)</summary>
  Guid? LastProcessedEventId { get; }
}
```

### Constructor Injection

```csharp
[FireAt(LifecycleStage.PostPerspectiveAsync)]
public class PerspectiveProgressReceptor : IReceptor<IEvent> {
  private readonly ILogger _logger;
  private readonly ILifecycleContext _context;  // Optional injection

  public PerspectiveProgressReceptor(
      ILogger<PerspectiveProgressReceptor> logger,
      ILifecycleContext context) {  // Injected by Whizbang

    _logger = logger;
    _context = context;
  }

  public ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    _logger.LogInformation(
      "Perspective {Perspective} processed event {EventId} from stream {StreamId}",
      _context.PerspectiveName,
      _context.EventId,
      _context.StreamId);

    return ValueTask.CompletedTask;
  }
}
```

### Filtering by Context

Use context to filter invocations:

```csharp
[FireAt(LifecycleStage.PostPerspectiveInline)]
public class SpecificPerspectiveReceptor : IReceptor<ProductCreatedEvent> {
  private readonly ILifecycleContext _context;

  public SpecificPerspectiveReceptor(ILifecycleContext context) {
    _context = context;
  }

  public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // Only execute for "ProductCatalog" perspective
    if (_context.PerspectiveName != "ProductCatalog") {
      return ValueTask.CompletedTask;  // Skip
    }

    // Do work specific to ProductCatalog perspective
    Console.WriteLine($"ProductCatalog processed {evt.ProductId}");
    return ValueTask.CompletedTask;
  }
}
```

**When to Inject Context**:
- ✅ Need to know current stage (when using multiple `[FireAt]`)
- ✅ Need to filter by perspective name
- ✅ Need stream ID or event ID for logging
- ✅ Need checkpoint position for custom logic
- ❌ Don't need metadata - keep constructor simple

---

## Security Context in Lifecycle Receptors

:::new
Security context is now established before lifecycle receptor invocation in PerspectiveWorker (v1.0.0).
:::

Lifecycle receptors have full access to security context from the message envelope via `IMessageContext`:

### Accessing Security Context

```csharp
[FireAt(LifecycleStage.PrePerspectiveAsync)]
public class AuditReceptor : IReceptor<IEvent> {
  private readonly IMessageContext _messageContext;
  private readonly ILogger<AuditReceptor> _logger;

  public AuditReceptor(IMessageContext messageContext, ILogger<AuditReceptor> logger) {
    _messageContext = messageContext;
    _logger = logger;
  }

  public ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    // UserId is available from the message envelope's security context
    var userId = _messageContext.UserId;

    _logger.LogInformation(
      "User {UserId} triggered perspective update for event {EventId}",
      userId,
      _messageContext.MessageId);

    return ValueTask.CompletedTask;
  }
}
```

### Available Security Properties

The `IMessageContext` provides access to:

| Property | Type | Description |
|----------|------|-------------|
| `UserId` | `string?` | User identifier from the message's security context |
| `MessageId` | `MessageId` | The message identifier |
| `CorrelationId` | `CorrelationId` | Correlation ID for distributed tracing |
| `CausationId` | `MessageId` | ID of the message that caused this one |
| `Timestamp` | `DateTimeOffset` | When the message was created |
| `Metadata` | `IReadOnlyDictionary<string, object>` | Custom metadata |

### Lifecycle Stages with Security Context

Security context is established **before** each lifecycle receptor invocation for the following stages:

- `PrePerspectiveAsync` - Before perspective processing
- `PrePerspectiveInline` - Before perspective processing (blocking)
- `PostPerspectiveInline` - After perspective checkpoint saved (blocking)

### Example: User-Aware Audit Trail

```csharp
[FireAt(LifecycleStage.PostPerspectiveInline)]
public class UserAuditReceptor : IReceptor<OrderPlacedEvent> {
  private readonly IMessageContext _messageContext;
  private readonly IAuditService _audit;

  public UserAuditReceptor(IMessageContext messageContext, IAuditService audit) {
    _messageContext = messageContext;
    _audit = audit;
  }

  public async ValueTask HandleAsync(OrderPlacedEvent evt, CancellationToken ct) {
    await _audit.RecordAsync(new AuditEntry {
      UserId = _messageContext.UserId,
      EventType = nameof(OrderPlacedEvent),
      EventId = _messageContext.MessageId.Value,
      CorrelationId = _messageContext.CorrelationId.Value,
      Timestamp = _messageContext.Timestamp,
      Details = $"Order {evt.OrderId} placed"
    });
  }
}
```

**Key Points**:
- Security context is established from the message envelope's hops
- `UserId` will be `null` if no security context was attached to the message
- Each envelope in a batch gets its own security context established before invocation

---

## Compile-Time Registration (Production)

### How It Works

Source generators discover lifecycle receptors and wire them automatically:

1. **ReceptorDiscoveryGenerator** scans your code for:
   - Classes implementing `IReceptor<TMessage>` or `IReceptor<TMessage, TResponse>`
   - `[FireAt]` attributes on those classes
   - Constructor parameters (including `ILifecycleContext`)

2. **Generated Code** creates invocation logic:
   - `ReceptorInvoker.g.cs` - Switches on message type and lifecycle stage
   - `ReceptorRegistrations.g.cs` - Registers receptors with DI container

3. **Zero Reflection** - All routing is compile-time generated code

### Example Generated Code

**Your Receptor**:
```csharp
[FireAt(LifecycleStage.PostPerspectiveAsync)]
public class ProductMetricsReceptor : IReceptor<ProductCreatedEvent> {
  public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // Track metrics
    return ValueTask.CompletedTask;
  }
}
```

**Generated Invocation** (simplified):
```csharp
// LifecycleInvoker.g.cs
public async ValueTask InvokeAtStageAsync(
    object message,
    LifecycleStage stage,
    ILifecycleContext context,
    CancellationToken cancellationToken) {

  var messageType = message.GetType();

  // Generated routing for (ProductCreatedEvent, PostPerspectiveAsync)
  if (messageType == typeof(ProductCreatedEvent)
      && stage == LifecycleStage.PostPerspectiveAsync) {

    // Scope created per invocation - supports scoped dependencies
    using var scope = _scopeFactory.CreateScope();
    var receptor = scope.ServiceProvider.GetRequiredService<ProductMetricsReceptor>();
    await receptor.HandleAsync((ProductCreatedEvent)message, cancellationToken);
  }

  // ... more generated branches for other receptors
}
```

**Benefits**:
- ✅ Zero reflection - fully AOT-compatible
- ✅ Compile-time validation
- ✅ Fast dispatch (no dictionary lookups)
- ✅ Incremental compilation (sealed records, syntactic filtering)
- ✅ **Scoped dependency support** - receptors can inject `DbContext`, `IOrchestratorAgent`, etc.

---

## Runtime Registration (Testing)

### The `ILifecycleReceptorRegistry`

For test scenarios, use runtime registration to dynamically add/remove receptors:

```csharp
public interface ILifecycleReceptorRegistry {
  /// <summary>Register a receptor to fire at a specific lifecycle stage</summary>
  void Register<TMessage>(object receptor, LifecycleStage stage)
    where TMessage : IMessage;

  /// <summary>Unregister a previously registered receptor</summary>
  bool Unregister<TMessage>(object receptor, LifecycleStage stage)
    where TMessage : IMessage;

  /// <summary>Get all receptors registered for a message type and stage</summary>
  IReadOnlyList<object> GetReceptors(Type messageType, LifecycleStage stage);

  /// <summary>Get handler delegates for AOT-compatible invocation</summary>
  IReadOnlyList<Func<object, CancellationToken, ValueTask>> GetHandlers(
    Type messageType, LifecycleStage stage);
}
```

### Test Pattern

Use runtime registration for test synchronization:

```csharp
[Test]
public async Task CreateProduct_UpdatesPerspective_DeterministicallyAsync() {
  // Arrange
  var completionSource = new TaskCompletionSource<bool>();
  var receptor = new PerspectiveCompletionReceptor<ProductCreatedEvent>(completionSource);

  var registry = _host.Services.GetRequiredService<ILifecycleReceptorRegistry>();

  // Register receptor at PostPerspectiveInline (blocking stage)
  registry.Register<ProductCreatedEvent>(receptor, LifecycleStage.PostPerspectiveInline);

  try {
    // Act - dispatch command
    var command = new CreateProductCommand("Widget", 9.99m);
    await _dispatcher.SendAsync(command);

    // Wait for perspective processing to complete (deterministic!)
    await completionSource.Task.WaitAsync(TimeSpan.FromSeconds(15));

    // Assert - perspective data is guaranteed to be saved
    var product = await _productLens.GetByIdAsync(command.ProductId);
    Assert.That(product).IsNotNull();
    Assert.That(product!.Name).IsEqualTo("Widget");

  } finally {
    // Always unregister
    registry.Unregister<ProductCreatedEvent>(receptor, LifecycleStage.PostPerspectiveInline);
  }
}
```

**Key Points**:
- **Only supports void receptors** (`IReceptor<TMessage>`) - no response types
- **AOT-compatible** - uses pattern matching (`is IReceptor<TMessage>`), not reflection
- **Thread-safe** - uses `ConcurrentDictionary` internally
- **Must unregister** - use try/finally to ensure cleanup

See [Lifecycle Synchronization](../testing/lifecycle-synchronization.md) for complete test patterns.

---

## AOT-Compatible Design

### Pattern Matching (Not Reflection)

The runtime registry uses **pattern matching** instead of reflection:

```csharp
// In DefaultLifecycleReceptorRegistry.cs
private static Func<object, CancellationToken, ValueTask> _createHandler<TMessage>(object receptor)
    where TMessage : IMessage {

  // Pattern matching is compile-time, not reflection!
  if (receptor is not IReceptor<TMessage> voidReceptor) {
    throw new ArgumentException(
      $"Receptor must implement IReceptor<{typeof(TMessage).Name}>.");
  }

  // Return delegate that calls HandleAsync
  return async (msg, ct) => await voidReceptor.HandleAsync((TMessage)msg, ct);
}
```

**Why This Works**:
- `is IReceptor<TMessage>` is pattern matching (compile-time check)
- No `GetType()`, `GetInterfaces()`, or `Invoke()` calls
- Fully trimmable and AOT-publishable
- Creates delegate upfront, stores for fast invocation

### Delegate-Based Invocation

Registry stores **delegates** alongside receptors:

```csharp
// Internal storage: (Receptor instance, Handler delegate)
ConcurrentDictionary<
  (Type MessageType, LifecycleStage Stage),
  List<(object Receptor, Func<object, CancellationToken, ValueTask> Handler)>
> _receptors;

// Registration creates delegate immediately
public void Register<TMessage>(object receptor, LifecycleStage stage) {
  var handler = _createHandler<TMessage>(receptor);  // Pattern matching
  _receptors.AddOrUpdate(key,
    _ => new List<...> { (receptor, handler) },
    (_, list) => { list.Add((receptor, handler)); return list; });
}

// Invocation is direct delegate call (no reflection!)
var handlers = registry.GetHandlers(typeof(ProductCreatedEvent), LifecycleStage.PostPerspectiveAsync);
foreach (var handler in handlers) {
  await handler(message, cancellationToken);  // Direct call!
}
```

**Benefits**:
- ✅ Zero reflection in hot path
- ✅ Native AOT compatible
- ✅ Fast invocation (delegates are inlined by JIT/AOT)
- ✅ Type-safe at registration time

---

## Lifecycle Receptor Patterns

### Pattern 1: Metrics Collection

Track metrics after specific stages:

```csharp
[FireAt(LifecycleStage.PostOutboxAsync)]
public class OutboxMetricsReceptor : IReceptor<IEvent> {
  private readonly IMetricsCollector _metrics;

  public OutboxMetricsReceptor(IMetricsCollector metrics) {
    _metrics = metrics;
  }

  public ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    _metrics.Increment("outbox.published",
      tags: new[] { $"event_type:{evt.GetType().Name}" });
    return ValueTask.CompletedTask;
  }
}
```

### Pattern 2: Audit Logging

Log message flow through pipeline:

```csharp
[FireAt(LifecycleStage.PreInboxInline)]
[FireAt(LifecycleStage.PostInboxAsync)]
public class InboxAuditReceptor : IReceptor<ICommand> {
  private readonly IAuditLog _audit;
  private readonly ILifecycleContext _context;

  public InboxAuditReceptor(IAuditLog audit, ILifecycleContext context) {
    _audit = audit;
    _context = context;
  }

  public ValueTask HandleAsync(ICommand cmd, CancellationToken ct) {
    var stage = _context.CurrentStage == LifecycleStage.PreInboxInline
      ? "received"
      : "processed";

    _audit.Log($"Command {cmd.GetType().Name} {stage} at {DateTime.UtcNow}");
    return ValueTask.CompletedTask;
  }
}
```

### Pattern 3: Test Synchronization

Wait for perspective processing to complete:

```csharp
[FireAt(LifecycleStage.PostPerspectiveInline)]  // Blocking stage
public class PerspectiveCompletionReceptor<TEvent> : IReceptor<TEvent>
  where TEvent : IEvent {

  private readonly TaskCompletionSource<bool> _completionSource;
  private readonly string? _perspectiveName;
  private readonly ILifecycleContext? _context;

  public PerspectiveCompletionReceptor(
      TaskCompletionSource<bool> completionSource,
      string? perspectiveName = null,
      ILifecycleContext? context = null) {

    _completionSource = completionSource;
    _perspectiveName = perspectiveName;
    _context = context;
  }

  public ValueTask HandleAsync(TEvent message, CancellationToken ct) {
    // Filter by perspective if specified
    if (_context is not null && _perspectiveName is not null) {
      if (_context.PerspectiveName != _perspectiveName) {
        return ValueTask.CompletedTask;  // Not our perspective
      }
    }

    // Signal test to proceed
    _completionSource.TrySetResult(true);
    return ValueTask.CompletedTask;
  }
}
```

See [Lifecycle Synchronization](../testing/lifecycle-synchronization.md) for complete test patterns.

### Pattern 4: Custom Indexing

Build custom search indices after perspective updates:

```csharp
[FireAt(LifecycleStage.PostPerspectiveAsync)]
public class SearchIndexReceptor : IReceptor<ProductCreatedEvent> {
  private readonly ISearchIndexer _indexer;

  public SearchIndexReceptor(ISearchIndexer indexer) {
    _indexer = indexer;
  }

  public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // Index product for search (non-blocking)
    return _indexer.IndexProductAsync(evt.ProductId, evt.Name, ct);
  }
}
```

### Pattern 5: Cache Invalidation

Invalidate caches when perspectives update:

```csharp
[FireAt(LifecycleStage.PostPerspectiveAsync)]
public class CacheInvalidationReceptor : IReceptor<IEvent> {
  private readonly IDistributedCache _cache;
  private readonly ILifecycleContext _context;

  public CacheInvalidationReceptor(IDistributedCache cache, ILifecycleContext context) {
    _cache = cache;
    _context = context;
  }

  public async ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    // Invalidate cache for this stream (aggregate)
    if (_context.StreamId.HasValue) {
      var cacheKey = $"aggregate:{_context.StreamId.Value}";
      await _cache.RemoveAsync(cacheKey, ct);
    }
  }
}
```

---

## Performance Considerations

### Keep Lifecycle Receptors Fast

Lifecycle receptors execute **synchronously in the message processing path**:

✅ **Good Practices**:
- Quick in-memory operations (< 5ms)
- Async logging (fire-and-forget)
- Metrics collection (counters, gauges)
- Test signaling (TaskCompletionSource)
- Cache key building

❌ **Avoid**:
- Database queries (use separate handlers)
- HTTP calls (use separate handlers)
- Heavy computation (offload to background)
- Blocking operations in Async stages
- Long-running operations in Inline stages

### Inline vs Async Stages

**Inline stages block next step** - keep them extremely fast:
```csharp
[FireAt(LifecycleStage.PostPerspectiveInline)]  // BLOCKING!
public class FastCompletionReceptor : IReceptor<IEvent> {
  public ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    // ✅ Fast: Signal completion
    _completionSource.TrySetResult(true);
    return ValueTask.CompletedTask;

    // ❌ NEVER: Database query in inline stage
    // await _dbContext.Products.FirstAsync(...);  // BLOCKS ENTIRE PIPELINE!
  }
}
```

**Async stages run in parallel** - more flexible but still keep fast:
```csharp
[FireAt(LifecycleStage.PostPerspectiveAsync)]  // Non-blocking
public class AsyncMetricsReceptor : IReceptor<IEvent> {
  public async ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    // ✅ Acceptable: Async logging (fast)
    await _logger.LogAsync($"Processed {evt.GetType().Name}");

    // ⚠️ Avoid: Slow operations still impact throughput
    // Better to use separate background handler
  }
}
```

### Exception Handling

**Lifecycle receptor errors are logged but don't fail message processing**:

```csharp
[FireAt(LifecycleStage.PostPerspectiveAsync)]
public class MetricsReceptor : IReceptor<IEvent> {
  public ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    try {
      _metrics.RecordEvent(evt.GetType().Name);
    } catch (Exception ex) {
      // Logged by framework, doesn't fail message processing
      // Perspective checkpoint still advances
    }
    return ValueTask.CompletedTask;
  }
}
```

**For critical operations**, use Inline stages to detect failures:
```csharp
[FireAt(LifecycleStage.PostPerspectiveInline)]  // Blocking - errors propagate
public class CriticalReceptor : IReceptor<IEvent> {
  public ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    // If this throws, checkpoint won't advance
    // Use for critical operations only
    return ValueTask.CompletedTask;
  }
}
```

---

## Compile-Time vs Runtime Registration

| Feature | Compile-Time ([FireAt]) | Runtime (ILifecycleReceptorRegistry) |
|---------|------------------------|-------------------------------------|
| **Registration** | Automatic via source generator | Manual via Register() |
| **Discovery** | Build-time | Runtime only |
| **Performance** | Fastest (no dictionary lookup) | Fast (delegate-based) |
| **Use Cases** | Production metrics, logging | Test synchronization |
| **Lifecycle** | Application lifetime | Scoped (register/unregister) |
| **Response Types** | ✅ Supported | ❌ Void only |
| **AOT Compatible** | ✅ Yes | ✅ Yes (pattern matching) |
| **Reflection** | ❌ Zero | ❌ Zero |

**Recommendation**:
- **Use [FireAt]** for production features (metrics, logging, auditing)
- **Use Registry** for test scenarios (wait for perspective completion)

---

## Registration Setup

### Production (Compile-Time)

**Step 1**: Apply `[FireAt]` to receptors:
```csharp
[FireAt(LifecycleStage.PostPerspectiveAsync)]
public class MyMetricsReceptor : IReceptor<ProductCreatedEvent> {
  public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // Track metrics
    return ValueTask.CompletedTask;
  }
}
```

**Step 2**: Register Whizbang services:
```csharp
// In Program.cs or Startup.cs
services
  .AddWhizbang()
  .WithEFCore<MyDbContext>()
  .WithDriver.Postgres;
```

**Done!** Source generators discover your receptors automatically.

### Testing (Runtime)

**Step 1**: Get registry from DI:
```csharp
var registry = _host.Services.GetRequiredService<ILifecycleReceptorRegistry>();
```

**Step 2**: Register receptor:
```csharp
var completionSource = new TaskCompletionSource<bool>();
var receptor = new PerspectiveCompletionReceptor<ProductCreatedEvent>(completionSource);

registry.Register<ProductCreatedEvent>(receptor, LifecycleStage.PostPerspectiveInline);
```

**Step 3**: Use and cleanup:
```csharp
try {
  await _dispatcher.SendAsync(command);
  await completionSource.Task.WaitAsync(TimeSpan.FromSeconds(15));
} finally {
  registry.Unregister<ProductCreatedEvent>(receptor, LifecycleStage.PostPerspectiveInline);
}
```

**Helper method available**:
```csharp
// Extension method wraps registration/unregistration
await _host.WaitForPerspectiveCompletionAsync<ProductCreatedEvent>(
  perspectiveName: "ProductCatalog",
  timeoutMilliseconds: 15000
);
```

See [Lifecycle Synchronization](../testing/lifecycle-synchronization.md) for complete patterns.

---

## Related Topics

- [Lifecycle Stages](lifecycle-stages.md) - All 18 stages with timing diagrams
- [Receptors Guide](receptors.md) - Core receptor concepts and patterns
- [Testing: Lifecycle Synchronization](../testing/lifecycle-synchronization.md) - Deterministic test patterns
- [Source Generators](../advanced/source-generators.md) - How lifecycle receptors are discovered
- [AOT Compatibility](../deployment/aot-compatibility.md) - Zero-reflection design

---

## Summary

- **Reuse `IReceptor<TMessage>` interface** - No new interfaces to learn
- **`[FireAt]` controls timing** - Declarative lifecycle stage selection
- **Multiple attributes supported** - Fire at multiple stages
- **Default stages**: `LocalImmediateInline`, `PreOutboxInline`, `PostInboxInline`
- **Adding `[FireAt]` replaces defaults** - Receptor fires ONLY at specified stages
- **Two mutually exclusive paths**: Local (mediator) vs Distributed (outbox/inbox)
- **Optional `ILifecycleContext` injection** - Access metadata when needed
- **Scoped dependency support** - Receptors can inject `DbContext`, `IOrchestratorAgent`, etc.
- **Compile-time registration** - Source generators wire automatically via `IReceptorRegistry`
- **Runtime registration** - `ILifecycleReceptorRegistry` for tests
- **Zero reflection** - Fully AOT-compatible via `IReceptorInvoker` (pattern matching + delegates)
- **Keep receptors fast** - < 5ms, avoid database queries in hot path
- **Use Inline stages carefully** - They block next step (for critical operations only)
