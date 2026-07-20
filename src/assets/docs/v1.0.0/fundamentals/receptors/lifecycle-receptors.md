---
title: Lifecycle Receptors
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - src/Whizbang.Core/Messaging/LifecycleStage.cs
  - src/Whizbang.Core/Messaging/ILifecycleContext.cs
  - src/Whizbang.Core/Messaging/ProcessingMode.cs
  - src/Whizbang.Core/Messaging/ReceptorIdempotentAttribute.cs
  - src/Whizbang.Core/Messaging/IReceptorInvoker.cs
  - src/Whizbang.Core/Messaging/IReceptorRegistry.cs
  - src/Whizbang.Core/Messaging/ReceptorInvoker.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/FireAtAttributeTests.cs
  - tests/Whizbang.Core.Tests/Messaging/LifecycleStageTests.cs
  - tests/Whizbang.Core.Tests/Messaging/LifecycleStageExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Messaging/LifecycleContextTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ReceptorInvokerTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ReceptorRegistryRuntimeRegistrationTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ReceptorIdempotentAttributeTests.cs
lastMaintainedCommit: '01f07906'
---

# Lifecycle Receptors

Lifecycle receptors are **regular receptors** that execute at specific stages in the message processing pipeline. Using the `[FireAt]` attribute, you can declaratively control when your receptors fire without changing any code.

## Core Concept

**Lifecycle receptors reuse the existing `IReceptor<TMessage>` interface** - no new interfaces to learn. The `[FireAt]` attribute controls timing:

```csharp{title="Core Concept" description="Lifecycle receptors reuse the existing IReceptor<TMessage> interface - no new interfaces to learn." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Core", "Concept"]}
// Regular receptor - fires at default stages (see below)
public class CreateTenantHandler : IReceptor<CreateTenantCommand, TenantCreatedEvent> {
  public ValueTask<TenantCreatedEvent> HandleAsync(CreateTenantCommand cmd, CancellationToken ct) {
    // Business logic fires at:
    // - LocalImmediateDetached (messages dispatched by this service)
    // - PostInboxDetached (messages arriving from other services via transport)
    return ValueTask.FromResult(new TenantCreatedEvent(TrackedGuid.NewMedo()));
  }
}

// Lifecycle receptor - fires ONLY at PostPerspectiveDetached
[FireAt(LifecycleStage.PostPerspectiveDetached)]
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
- Receptors without `[FireAt]` fire at **default stages** (LocalImmediateDetached, PostInboxDetached)
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

```csharp{title="Example with Scoped Dependencies" description="Example with Scoped Dependencies" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Example", "Scoped"]}
[FireAt(LifecycleStage.PostInboxInline)]
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

Receptor invocation creates a scope per invocation, so scoped services resolve correctly:

```csharp{title="How It Works" description="Receptor invocation creates a scope per invocation, so scoped services resolve correctly:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Works"] unverified="illustrative generated-code sketch — simplified scope-per-invocation pattern, not a literal testable snippet"}
// Generated code pattern (simplified)
if (messageType == typeof(StartedEvent) && stage == LifecycleStage.PostInboxInline) {
  using var scope = _scopeFactory.CreateScope();
  var receptor = scope.ServiceProvider.GetKeyedService<IReceptor<StartedEvent>>("StartupHandler");
  if (receptor is not null) await receptor.HandleAsync((StartedEvent)message, cancellationToken);
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

```csharp{title="Basic Usage" description="Apply [FireAt] to receptor classes to control execution timing:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Basic", "Usage"] tests=["FireAtAttributeTests.FireAtAttribute_AppliedToClass_CanBeRetrievedAsync", "FireAtAttributeTests.FireAtAttribute_Constructor_StoresLifecycleStageAsync"]}
using Whizbang.Core;
using Whizbang.Core.Observability;

[FireAt(LifecycleStage.PostPerspectiveDetached)]
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

```csharp{title="Multiple Stages (Multiple Attributes)" description="Apply [FireAt] multiple times to fire at multiple stages:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Multiple", "Stages"] tests=["FireAtAttributeTests.FireAtAttribute_MultipleAttributes_AllRetrievedAsync", "FireAtAttributeTests.FireAtAttribute_AttributeUsage_AllowsMultipleAsync"]}
// Fire at BOTH PreOutbox and PostOutbox stages
[FireAt(LifecycleStage.PreOutboxInline)]
[FireAt(LifecycleStage.PostOutboxDetached)]
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
Shipped behavior: receptors without `[FireAt]` are registered at `LocalImmediateDetached` and `PostInboxDetached` by the receptor discovery generator. Source-service filtering prevents double-fire: `LocalImmediateDetached` only fires for messages originating from this service, `PostInboxDetached` only for messages arriving from other services via transport.
:::

Receptors **without `[FireAt]` fire at default stages** based on where the message came from:

| Path | Default Stage | When |
|------|--------------|------|
| **Local** | `LocalImmediateDetached` | Message dispatched by this service |
| **Distributed (Receiver)** | `PostInboxDetached` | Message received from another service via transport |

```csharp{title="Default Behavior (No Attribute)" description="Default Behavior (No Attribute)" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Default", "Behavior"] tests=["ReceptorDiscoveryGeneratorTests.Generator_ReceptorWithoutFireAt_RegisteredAtDefaultStagesAsync"]}
// No [FireAt] attribute = fires at default stages
public class CreateProductReceptor : IReceptor<CreateProductCommand, ProductCreatedEvent> {
  public async ValueTask<ProductCreatedEvent> HandleAsync(
      CreateProductCommand cmd,
      CancellationToken ct) {

    // This executes at:
    // - LocalImmediateDetached (command dispatched by this service)
    // - PostInboxDetached (command arriving from another service via transport)
    var product = new Product(cmd.Name, cmd.Price);
    await _dbContext.Products.AddAsync(product, ct);

    return new ProductCreatedEvent(product.Id, product.Name);
  }
}
```

**Why these defaults?**
- **Paths are mutually exclusive** - source-service filtering means a message fires local defaults OR inbox defaults, never both
- **Default receptors "just work"** regardless of how message is dispatched
- **Adding `[FireAt]` opts OUT of defaults** - you control exactly when receptor fires:

```csharp{title="Default Behavior (No Attribute) - LocalOnlyHandler" description="Default Behavior (No Attribute) - LocalOnlyHandler" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Default", "Behavior"] tests=["ReceptorDiscoveryGeneratorTests.Generator_ReceptorWithFireAt_RegisteredOnlyAtSpecifiedStageAsync"]}
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

```csharp{title="Interface Definition" description="Full ILifecycleContext interface with all properties" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Interface", "Definition"] tests=["LifecycleContextTests.LifecycleExecutionContext_Constructor_StoresAllPropertiesAsync", "LifecycleContextTests.LifecycleExecutionContext_OptionalProperties_CanBeNullAsync", "LifecycleContextTests.Receptor_WithLifecycleContext_CanAccessContextPropertiesAsync", "ProcessingModeTests.ILifecycleContext_HasProcessingModePropertyAsync"]}
public interface ILifecycleContext {
  /// <summary>The lifecycle stage currently executing</summary>
  LifecycleStage CurrentStage { get; }

  /// <summary>The event ID that triggered this invocation (null for stages that
  /// don't process specific events, e.g. ImmediateDetached)</summary>
  Guid? EventId { get; }

  /// <summary>The stream ID (aggregate ID) for event-sourced messages</summary>
  Guid? StreamId { get; }

  /// <summary>The perspective Type being processed (null if not perspective stage)</summary>
  Type? PerspectiveType { get; }

  /// <summary>The last processed event ID for the perspective (checkpoint position)</summary>
  Guid? LastProcessedEventId { get; }

  /// <summary>Outbox or Inbox - distinguishes local publish vs transport receive</summary>
  MessageSource? MessageSource { get; }

  /// <summary>Current attempt number (1-based). Increments on retries after failures.</summary>
  int? AttemptNumber { get; }

  /// <summary>Processing mode: Live, Replay, or Rebuild</summary>
  ProcessingMode? ProcessingMode { get; }

  /// <summary>Convenience: true when ProcessingMode is Replay or Rebuild</summary>
  bool IsReplay => ProcessingMode is Messaging.ProcessingMode.Replay or Messaging.ProcessingMode.Rebuild;

  /// <summary>True when this event has never had its handlers fire for this perspective
  /// before. Always true in live processing; false during Replay/Rebuild for events
  /// whose handlers already ran in a prior pass.</summary>
  bool IsNewEvent => true;
}
```

### Property Reference

| Property | Type | Set For | Description |
|----------|------|---------|-------------|
| `CurrentStage` | `LifecycleStage` | All stages | The lifecycle stage currently executing |
| `EventId` | `Guid?` | Event stages | The event ID that triggered this invocation. Null for stages that don't process specific events (e.g., ImmediateDetached). |
| `StreamId` | `Guid?` | Perspective, outbox, inbox stages | The stream ID being processed. Null for immediate dispatch. |
| `PerspectiveType` | `Type?` | PrePerspective*, PostPerspective* | The `Type` of the perspective class being executed. Use to filter by specific perspective. |
| `LastProcessedEventId` | `Guid?` | Perspective stages | The checkpoint position after processing completes. |
| `MessageSource` | `MessageSource?` | Distribute stages only | `Outbox` for local publish, `Inbox` for transport receive. Allows filtering in distribute receptors. |
| `AttemptNumber` | `int?` | Perspective stages | 1-based attempt number. Increments on retries (e.g., when checkpoint save fails after successful processing). |
| `ProcessingMode` | `ProcessingMode?` | Perspective stages | `Live` (normal), `Replay` (rewind), or `Rebuild` (full rebuild). Null for non-perspective stages. |
| `IsReplay` | `bool` | All stages | Convenience: true when `ProcessingMode` is `Replay` or `Rebuild`. |
| `IsNewEvent` | `bool` | Perspective stages | True when this event has never had its handlers fire for this perspective. Always true in live processing. |

### ProcessingMode Enum {#processing-mode}

`ProcessingMode` indicates whether the current lifecycle invocation is live processing or a replay/rebuild operation. During replay and rebuild, side-effect receptors (email, webhooks, cache busting) are suppressed by default for events that were already processed in a prior pass (`IsNewEvent` false). Events marked new still fire all receptors. Use `[ReceptorIdempotent(AlwaysFire = true)]` to opt specific receptors into firing for every applied event during replay/rebuild.

| Value | Numeric | Description |
|-------|---------|-------------|
| `Live` | 0 | Normal live processing. All receptors fire as usual. |
| `Replay` | 1 | Rewind replay triggered by a late-arriving event. Receptors suppressed for already-processed events unless decorated with `[ReceptorIdempotent(AlwaysFire = true)]`. |
| `Rebuild` | 2 | Full or partial perspective rebuild. Receptors suppressed for already-processed events unless decorated with `[ReceptorIdempotent(AlwaysFire = true)]`. |

```csharp{title="ProcessingMode Usage" description="Branch behavior based on processing mode" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "ProcessingMode", "Replay"] tests=["ProcessingModeTests.ILifecycleContext_HasProcessingModePropertyAsync", "ProcessingModeTests.ProcessingMode_Replay_HasValueOneAsync", "ReceptorIdempotentAttributeTests.ReceptorIdempotentAttribute_AlwaysFire_CanBeSetTrueAsync"]}
[ReceptorIdempotent(AlwaysFire = true)]
[FireAt(LifecycleStage.PostPerspectiveInline)]
public class DependentModelUpdater : IReceptor<OrderCreatedEvent> {
  private readonly ILifecycleContext? _context;

  public DependentModelUpdater(ILifecycleContext? context = null) {
    _context = context;
  }

  public ValueTask HandleAsync(OrderCreatedEvent evt, CancellationToken ct) {
    if (_context?.ProcessingMode == ProcessingMode.Replay) {
      // Skip expensive operations during replay, just update dependent model
    }
    return ValueTask.CompletedTask;
  }
}
```

### AttemptNumber Usage

Perspective lifecycle stages may fire multiple times if processing succeeds but the checkpoint save fails. Use `AttemptNumber` to guard against duplicate side effects:

```csharp{title="AttemptNumber Usage" description="Use AttemptNumber to only fire on first attempt" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "AttemptNumber", "Retry"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
public class NotificationReceptor : IReceptor<OrderCreatedEvent> {
  private readonly ILifecycleContext _context;

  public NotificationReceptor(ILifecycleContext context) {
    _context = context;
  }

  public ValueTask HandleAsync(OrderCreatedEvent evt, CancellationToken ct) {
    if (_context.AttemptNumber > 1) {
      return ValueTask.CompletedTask; // Skip retries, only fire on first attempt
    }
    // Send notification...
    return ValueTask.CompletedTask;
  }
}
```

### Constructor Injection

```csharp{title="Constructor Injection" description="Constructor Injection" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Constructor", "Injection"] tests=["LifecycleContextTests.Receptor_WithLifecycleContext_CanAccessContextPropertiesAsync"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
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
      _context.PerspectiveType?.Name,
      _context.EventId,
      _context.StreamId);

    return ValueTask.CompletedTask;
  }
}
```

### Filtering by Context

Use context to filter invocations:

```csharp{title="Filtering by Context" description="Use context to filter invocations:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Filtering", "Context"]}
[FireAt(LifecycleStage.PostPerspectiveInline)]
public class SpecificPerspectiveReceptor : IReceptor<ProductCreatedEvent> {
  private readonly ILifecycleContext _context;

  public SpecificPerspectiveReceptor(ILifecycleContext context) {
    _context = context;
  }

  public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // Only execute for ProductCatalogPerspective
    if (_context.PerspectiveType?.Name != "ProductCatalogPerspective") {
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

Lifecycle receptors have full access to security context from the message envelope. This section explains **how security context is propagated** and **three methods to access it** (from simplest to most powerful).

### The Problem: HTTP Context Unavailable

When a lifecycle receptor fires at **deferred stages** like `PostPerspectiveDetached`, the original HTTP request has already completed. This means:

- `HttpContext` is `null` - the request is long gone
- Middleware-injected services (e.g., custom `UserContextManager`) that read from HTTP context will fail
- Any service that depends on `IHttpContextAccessor` will return `null`

**Example of what DOESN'T work**:
```csharp{title="The Problem: HTTP Context Unavailable" description="Example of what DOESN'T work:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Problem:", "HTTP"] unverified="counter-example — HttpContextAccessor is null at deferred stages; intentionally shows what does NOT work"}
// ❌ WRONG - This fails at PostPerspectiveDetached!
[FireAt(LifecycleStage.PostPerspectiveDetached)]
public class MyHandler(IHttpContextAccessor httpContextAccessor) : IReceptor<MyEvent> {
  public ValueTask HandleAsync(MyEvent evt, CancellationToken ct) {
    // httpContextAccessor.HttpContext is NULL - request is gone!
    var tenantId = httpContextAccessor.HttpContext?.GetTenantId();
    return ValueTask.CompletedTask;
  }
}
```

### Solution: Security Context Flows Through Message Hops

Whizbang captures security context (user ID, tenant ID, roles, permissions) when a message is dispatched and stores it in the **message envelope hops**. This context flows through:

```
HTTP Request → Command Dispatch → Outbox → Worker → Event → Perspective → Lifecycle Receptor
      ↓                ↓                      ↓                              ↓
SecurityContext → Stored in Hop → Extracted → Established before receptor → Available!
```

**Key insight**: Security context is **re-established** from the envelope before each lifecycle receptor invocation, making it available even when HTTP context is gone.

### Three Access Methods

Choose the method that fits your needs (simplest to most powerful):

#### Method 1: IMessageContext (Simplest)

For simple user/tenant access, inject `IMessageContext`:

```csharp{title="Method 1: IMessageContext (Simplest)" description="For simple user/tenant access, inject IMessageContext:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Method", "IMessageContext"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
public class TenantAwareHandler : IReceptor<ProductCreatedEvent> {
  private readonly IMessageContext _messageContext;
  private readonly ILogger<TenantAwareHandler> _logger;

  public TenantAwareHandler(IMessageContext messageContext, ILogger<TenantAwareHandler> logger) {
    _messageContext = messageContext;
    _logger = logger;
  }

  public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // ✅ Both UserId and TenantId are available!
    var userId = _messageContext.UserId;
    var tenantId = _messageContext.TenantId;

    _logger.LogInformation(
      "User {UserId} in tenant {TenantId} created product {ProductId}",
      userId,
      tenantId,
      evt.ProductId);

    return ValueTask.CompletedTask;
  }
}
```

**Available Properties**:

| Property | Type | Description |
|----------|------|-------------|
| `UserId` | `string?` | User identifier from security context |
| `TenantId` | `string?` | Tenant identifier from security context |
| `MessageId` | `MessageId` | The message identifier |
| `CorrelationId` | `CorrelationId` | Correlation ID for distributed tracing |
| `CausationId` | `MessageId` | ID of the message that caused this one |
| `Timestamp` | `DateTimeOffset` | When the message was created |
| `Metadata` | `IReadOnlyDictionary<string, object>` | Custom metadata |

#### Method 2: IScopeContextAccessor (Full Scope Access)

For access to the complete security scope including roles, permissions, and custom properties:

```csharp{title="Method 2: IScopeContextAccessor (Full Scope Access)" description="For access to the complete security scope including roles, permissions, and custom properties:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Method", "IScopeContextAccessor"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
public class PermissionAwareHandler : IReceptor<SensitiveOperationEvent> {
  private readonly IScopeContextAccessor _scopeContextAccessor;
  private readonly ILogger<PermissionAwareHandler> _logger;

  public PermissionAwareHandler(
      IScopeContextAccessor scopeContextAccessor,
      ILogger<PermissionAwareHandler> logger) {
    _scopeContextAccessor = scopeContextAccessor;
    _logger = logger;
  }

  public ValueTask HandleAsync(SensitiveOperationEvent evt, CancellationToken ct) {
    var context = _scopeContextAccessor.Current;

    if (context == null) {
      _logger.LogWarning("No scope context available");
      return ValueTask.CompletedTask;
    }

    // Scope identifiers live on context.Scope (PerspectiveScope)
    var tenantId = context.Scope.TenantId;
    var userId = context.Scope.UserId;

    // Roles and permissions live on the IScopeContext itself
    var roles = context.Roles;
    var permissions = context.Permissions;

    // Check permissions
    if (!context.HasPermission(new Permission("audit:read"))) {
      _logger.LogWarning("User {UserId} lacks audit:read permission", userId);
      return ValueTask.CompletedTask;
    }

    // Proceed with operation...
    return ValueTask.CompletedTask;
  }
}
```

**Available via `IScopeContext`**:

| Property | Type | Description |
|----------|------|-------------|
| `Scope` | `PerspectiveScope` | Scope identifiers: `TenantId`, `UserId`, `CustomerId`, `OrganizationId`, `AllowedPrincipals`, `Extensions` |
| `Roles` | `IReadOnlySet<string>` | User's roles |
| `Permissions` | `IReadOnlySet<Permission>` | User's permissions |
| `SecurityPrincipals` | `IReadOnlySet<SecurityPrincipalId>` | Security principals |
| `Claims` | `IReadOnlyDictionary<string, string>` | Custom claims |

Helper methods on `IScopeContext` include `HasPermission`, `HasAnyPermission`, `HasAllPermissions`, `HasRole`, `HasAnyRole`, `IsMemberOfAny`, and `IsMemberOfAll`.

#### Method 3: ISecurityContextCallback (Setup-Time Hook)

For complex scenarios where you need to **initialize custom services** when security context is established (before receptors run):

```csharp{title="Method 3: ISecurityContextCallback (Setup-Time Hook)" description="For complex scenarios where you need to initialize custom services when security context is established (before" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Method", "ISecurityContextCallback"]}
/// <summary>
/// Callback that fires when Whizbang establishes security context.
/// Use this to populate custom services with tenant/user information.
/// </summary>
public class CustomServiceSecurityCallback : ISecurityContextCallback {
  private readonly IMyCustomService _customService;

  public CustomServiceSecurityCallback(IMyCustomService customService) {
    _customService = customService;
  }

  public ValueTask OnContextEstablishedAsync(
      IScopeContext context,
      IMessageEnvelope envelope,
      IServiceProvider scopedProvider,
      CancellationToken cancellationToken = default) {

    // Called BEFORE lifecycle receptors run
    if (context?.Scope != null) {
      // Initialize your custom service with security context
      _customService.SetTenantContext(context.Scope.TenantId);
      _customService.SetUserContext(context.Scope.UserId);

      // Optionally load additional tenant configuration
      // _customService.LoadTenantConfiguration();
    }

    return ValueTask.CompletedTask;
  }
}

// Register in DI
services.AddScoped<ISecurityContextCallback, CustomServiceSecurityCallback>();
```

**Callback execution points** (in order):
1. `ServiceBusConsumerWorker` - When receiving messages from transport
2. `PerspectiveWorker` - Before lifecycle receptors at each stage
3. `ReceptorInvoker` - Before each receptor invocation

### Decision Guide: Which Method to Use

| Scenario | Recommended Method |
|----------|-------------------|
| Just need `UserId` or `TenantId` | **IMessageContext** |
| Need roles or permissions | **IScopeContextAccessor** |
| Need to initialize custom services | **ISecurityContextCallback** |
| Stateless handler (no custom services) | **IMessageContext** or **IScopeContextAccessor** |
| Custom `UserContextManager`-style service | **ISecurityContextCallback** |
| Simple audit logging | **IMessageContext** |
| Complex authorization checks | **IScopeContextAccessor** |

### Lifecycle Stages with Security Context

Security context is established **before** each lifecycle receptor invocation for ALL stages, including:

- `PrePerspectiveDetached` / `PrePerspectiveInline` - Before perspective processing
- `PostPerspectiveDetached` - After perspective data flush (checkpoint cursor not yet saved)
- `PostPerspectiveInline` - After perspective checkpoint saved
- `PreOutboxInline` / `PostOutboxDetached` - Outbox stages
- `PreInboxInline` / `PostInboxDetached` - Inbox stages
- `PostAllPerspectivesDetached` / `PostAllPerspectivesInline` - After ALL perspectives complete
- `PostLifecycleDetached` / `PostLifecycleInline` - End of lifecycle

### Example: Tenant-Aware Audit Trail

```csharp{title="Example: Tenant-Aware Audit Trail" description="Example: Tenant-Aware Audit Trail" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Example:", "Tenant-Aware"]}
[FireAt(LifecycleStage.PostPerspectiveInline)]
public class TenantAuditReceptor : IReceptor<OrderPlacedEvent> {
  private readonly IMessageContext _messageContext;
  private readonly IAuditService _audit;

  public TenantAuditReceptor(IMessageContext messageContext, IAuditService audit) {
    _messageContext = messageContext;
    _audit = audit;
  }

  public async ValueTask HandleAsync(OrderPlacedEvent evt, CancellationToken ct) {
    await _audit.RecordAsync(new AuditEntry {
      TenantId = _messageContext.TenantId,  // ✅ Available!
      UserId = _messageContext.UserId,       // ✅ Available!
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
- `UserId` and `TenantId` will be `null` if no security context was attached to the message
- Each envelope in a batch gets its own security context established before invocation
- `ISecurityContextCallback` runs **before** receptors, so your services are ready when receptors execute

---

## Compile-Time Registration (Production)

### How It Works

Source generators discover lifecycle receptors and wire them automatically:

1. **ReceptorDiscoveryGenerator** scans your code for:
   - Classes implementing `IReceptor<TMessage>` or `IReceptor<TMessage, TResponse>`
   - `[FireAt]` attributes on those classes
   - Constructor parameters (including `ILifecycleContext`)

2. **Generated Code** creates invocation logic:
   - `ReceptorRegistry.g.cs` - `GeneratedReceptorRegistry` pre-categorizes receptors by (message type, lifecycle stage) with typed invocation delegates
   - `DispatcherRegistrations.g.cs` - `AddReceptors()` / `AddWhizbangDispatcher()` extension methods register receptors and the registry with DI
   - `Dispatcher.g.cs` - Zero-reflection dispatcher routing

3. **Zero Reflection** - All routing is compile-time generated code

### Example Generated Code

**Your Receptor**:
```csharp{title="Example Generated Code" description="Your Receptor:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Example", "Generated"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
public class ProductMetricsReceptor : IReceptor<ProductCreatedEvent> {
  public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // Track metrics
    return ValueTask.CompletedTask;
  }
}
```

**Generated Registry Entry** (simplified):
```csharp{title="Example Generated Code (2)" description="Generated registry entry (simplified):" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Example", "Generated"] unverified="illustrative generated-registry entry — simplified representation of source-generator output"}
// ReceptorRegistry.g.cs - GeneratedReceptorRegistry
// Pre-categorized entry for (ProductCreatedEvent, PostPerspectiveDetached)
new ReceptorInfo(
  MessageType: typeof(ProductCreatedEvent),
  ReceptorId: "ProductMetricsReceptor",
  InvokeAsync: async (sp, msg, envelope, callerInfo, ct) => {
    // Keyed service resolution from the invocation scope - supports scoped dependencies
    var receptor = sp.GetKeyedService<IReceptor<ProductCreatedEvent>>("ProductMetricsReceptor");
    if (receptor is not null) await receptor.HandleAsync((ProductCreatedEvent)msg, ct);
    return null;
  }
);

// At runtime, ReceptorInvoker asks the registry for the exact (messageType, stage)
// pair and awaits each entry's delegate - no reflection, no dictionary-of-Type lookups
var receptors = _registry.GetReceptorsFor(typeof(ProductCreatedEvent), LifecycleStage.PostPerspectiveDetached);
```

**Benefits**:
- ✅ Zero reflection - fully AOT-compatible
- ✅ Compile-time validation
- ✅ Fast dispatch (no dictionary lookups)
- ✅ Incremental compilation (sealed records, syntactic filtering)
- ✅ **Scoped dependency support** - receptors can inject `DbContext`, `IOrchestratorAgent`, etc.

---

## Runtime Registration (Testing)

### The `IReceptorRegistry`

:::updated
Runtime registration is exposed through `IReceptorRegistry` (the same registry used for compile-time receptors). The earlier `ILifecycleReceptorRegistry` interface no longer exists.
:::

For test scenarios, use runtime registration to dynamically add/remove receptors:

```csharp{title="The `IReceptorRegistry`" description="For test scenarios, use runtime registration to dynamically add/remove receptors:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "IReceptorRegistry"]}
public interface IReceptorRegistry {
  /// <summary>Get all receptor entries registered for a message type and stage
  /// (compile-time entries plus runtime registrations)</summary>
  IReadOnlyList<ReceptorInfo> GetReceptorsFor(Type messageType, LifecycleStage stage);

  /// <summary>Register a void receptor to fire at a specific lifecycle stage</summary>
  void Register<TMessage>(IReceptor<TMessage> receptor, LifecycleStage stage)
    where TMessage : IMessage;

  /// <summary>Register a response receptor - its results are cascaded like compile-time receptors</summary>
  void Register<TMessage, TResponse>(IReceptor<TMessage, TResponse> receptor, LifecycleStage stage)
    where TMessage : IMessage;

  /// <summary>Unregister a previously registered void receptor</summary>
  bool Unregister<TMessage>(IReceptor<TMessage> receptor, LifecycleStage stage)
    where TMessage : IMessage;

  /// <summary>Unregister a previously registered response receptor</summary>
  bool Unregister<TMessage, TResponse>(IReceptor<TMessage, TResponse> receptor, LifecycleStage stage)
    where TMessage : IMessage;

  /// <summary>True when any runtime-registered receptor exists for the given message-type
  /// name - keeps messages alive at the receive-boundary drop gate</summary>
  bool HasAnyRuntimeReceptors(string messageType) => false;
}
```

### Test Pattern

Use runtime registration for test synchronization:

```csharp{title="Test Pattern" description="Use runtime registration for test synchronization:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Test", "Pattern"]}
[Test]
public async Task CreateProduct_UpdatesPerspective_DeterministicallyAsync() {
  // Arrange
  var completionSource = new TaskCompletionSource<bool>();
  var receptor = new PerspectiveCompletionReceptor<ProductCreatedEvent>(completionSource);

  var registry = _host.Services.GetRequiredService<IReceptorRegistry>();

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
    await Assert.That(product).IsNotNull();
    await Assert.That(product!.Name).IsEqualTo("Widget");

  } finally {
    // Always unregister
    registry.Unregister<ProductCreatedEvent>(receptor, LifecycleStage.PostPerspectiveInline);
  }
}
```

**Key Points**:
- **Void AND response receptors supported** - `Register<TMessage>` for void, `Register<TMessage, TResponse>` for response receptors (results are cascaded)
- **AOT-compatible** - message and receptor types are known at compile time via the generic parameters; no reflection
- **Thread-safe** - uses `ConcurrentDictionary` internally
- **Must unregister** - use try/finally (or a `using`-scoped helper) to ensure cleanup

See [Lifecycle Synchronization](../../operations/testing/lifecycle-synchronization.md) for complete test patterns.

---

## AOT-Compatible Design

### Typed Generics (Not Reflection)

Runtime registration is AOT-safe because the receptor and message types flow through **generic parameters** - the registry never inspects types with reflection. Each `Register<TMessage>` call builds a `ReceptorInfo` whose invocation delegate closes over the strongly-typed receptor:

```csharp{title="Typed Generics (Not Reflection)" description="Runtime registration builds a typed ReceptorInfo delegate up front:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Pattern", "Matching"] unverified="illustrative — simplified GeneratedReceptorRegistry.Register<T> sketch, not a literal testable snippet"}
// GeneratedReceptorRegistry (ReceptorRegistry.g.cs), simplified
public void Register<TMessage>(IReceptor<TMessage> receptor, LifecycleStage stage)
    where TMessage : IMessage {

  var info = new ReceptorInfo(
    MessageType: typeof(TMessage),
    // Stage-suffixed ID so the double-fire guardrail doesn't collide when the
    // same instance is registered at multiple stages
    ReceptorId: "runtime_" + receptor.GetType().FullName + "_" + stage,
    InvokeAsync: async (sp, msg, envelope, callerInfo, ct) => {
      // ILifecycleContext delivery via compile-time pattern match (not reflection)
      if (receptor is IAcceptsLifecycleContext contextAware) {
        var accessor = sp.GetService<ILifecycleContextAccessor>();
        if (accessor?.Current is not null) contextAware.SetLifecycleContext(accessor.Current);
      }
      await receptor.HandleAsync((TMessage)msg, ct);
      return null;
    });

  _addRuntime(typeof(TMessage), stage, receptor, info);
}
```

**Why This Works**:
- Types are known at compile time via the generic parameter
- `is IAcceptsLifecycleContext` is pattern matching, not reflection
- No `GetType().GetInterfaces()` or `MethodInfo.Invoke()` calls
- Fully trimmable and AOT-publishable
- Creates the delegate upfront, stores it for fast invocation

### Delegate-Based Invocation

The registry stores **`ReceptorInfo` entries** (with their delegates) alongside receptor instances:

```csharp{title="Delegate-Based Invocation" description="Registry stores ReceptorInfo entries with invocation delegates:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Delegate-Based", "Invocation"] unverified="illustrative — internal registry storage/invocation sketch, not a literal testable snippet"}
// Internal storage: (Receptor instance, ReceptorInfo with delegate)
ConcurrentDictionary<
  (Type MessageType, LifecycleStage Stage),
  List<(object Instance, ReceptorInfo Info)>
> _runtimeRegistrations;

// Lookup merges compile-time entries with runtime registrations
var receptors = registry.GetReceptorsFor(
  typeof(ProductCreatedEvent), LifecycleStage.PostPerspectiveDetached);

// ReceptorInvoker awaits each entry's delegate (no reflection!)
foreach (var info in receptors) {
  await info.InvokeAsync(scopedProvider, message, envelope, callerInfo, cancellationToken);
}
```

**Benefits**:
- ✅ Zero reflection in hot path
- ✅ Native AOT compatible
- ✅ Fast invocation (delegates are inlined by JIT/AOT)
- ✅ Type-safe at registration time

---

## Stage Isolation Guarantees {#stage-isolation}

:::new
Stage isolation guarantees added in v1.0.0
:::

**Receptors fire ONLY at their registered stage** - never at any other stage, even if it has a similar name. This is enforced at both compile-time (generated code) and runtime (registry lookup).

### Critical Isolation Rules

1. **Detached vs Inline stages are isolated**: `PostPerspectiveDetached` and `PostPerspectiveInline` are **different stages**
2. **Pre vs Post stages are isolated**: `PrePerspectiveDetached` and `PostPerspectiveDetached` are **different stages**
3. **Pipeline stages are isolated**: `PostPerspectiveDetached` and `PostAllPerspectivesDetached` are **different stages**

### Why This Matters

A common mistake is expecting a `PostPerspectiveDetached` receptor to fire at `PrePerspectiveDetached`. This would cause the receptor to execute **before** the perspective processes the event - exactly the opposite of what you want.

```csharp{title="Why This Matters" description="A common mistake is expecting a PostPerspectiveDetached receptor to fire at PrePerspectiveDetached." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Why", "This"]}
// ❌ WRONG EXPECTATION
// This receptor fires ONLY at PostPerspectiveDetached
[FireAt(LifecycleStage.PostPerspectiveDetached)]
public class AfterPerspectiveHandler : IReceptor<ProductCreatedEvent> {
  private readonly IProductLens _lens;

  public async ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // If this fired at PrePerspectiveDetached, GetByIdAsync would return stale/null data!
    // But because of stage isolation, it fires ONLY at PostPerspectiveDetached,
    // AFTER the perspective has processed and flushed to the database
    var product = await _lens.GetByIdAsync(evt.ProductId, ct);
    await _notificationService.SendAsync($"Product {product.Name} created!");
  }
}
```

### Temporal Ordering Guarantee

The perspective pipeline executes stages in strict order:

```
PrePerspectiveDetached → PrePerspectiveInline → apply events → save model + flush
    → PostPerspectiveDetached → checkpoint cursor saved → PostPerspectiveInline
```

**Stage isolation ensures**:
- `PrePerspectiveDetached` / `PrePerspectiveInline` fire BEFORE events are applied
- `PostPerspectiveDetached` fires AFTER perspective data is flushed (checkpoint cursor not yet saved)
- `PostPerspectiveInline` fires AFTER the checkpoint cursor is saved
- Each receptor type fires at exactly one point in this sequence

### Generated Code Verification

The generated registry pre-categorizes receptors by the exact (message type, stage) pair:

```csharp{title="Generated Code Verification" description="The generated registry keys entries on the exact message type + stage pair:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Generated", "Code"] unverified="illustrative — simplified generated-registry lookup sketch, not a literal testable snippet"}
// Generated in ReceptorRegistry.g.cs - lookup requires BOTH to match
var receptors = registry.GetReceptorsFor(
  typeof(ProductCreatedEvent),                 // ← EXACT message type
  LifecycleStage.PostPerspectiveDetached);     // ← EXACT stage

// Entries registered at any other stage are never returned
```

**Both conditions must match**:
1. Message type (`typeof(ProductCreatedEvent)`)
2. Lifecycle stage (`LifecycleStage.PostPerspectiveDetached`)

If either doesn't match, the receptor is skipped.

### Runtime Registry Isolation

The runtime registry also enforces stage isolation:

```csharp{title="Runtime Registry Isolation" description="The runtime registry also enforces stage isolation:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Runtime", "Registry"]}
// Registration
registry.Register<ProductCreatedEvent>(receptor, LifecycleStage.PostPerspectiveDetached);

// Lookup only returns receptors registered at EXACT stage
var receptors = registry.GetReceptorsFor(
  typeof(ProductCreatedEvent),
  LifecycleStage.PostPerspectiveDetached);  // Only PostPerspectiveDetached receptors

// PrePerspectiveDetached lookup returns DIFFERENT set
var preReceptors = registry.GetReceptorsFor(
  typeof(ProductCreatedEvent),
  LifecycleStage.PrePerspectiveDetached);  // Empty if no receptors registered at this stage
```

### Testing Stage Isolation

Use the test patterns below to verify your receptors fire at the correct stage:

```csharp{title="Testing Stage Isolation" description="Use the test patterns below to verify your receptors fire at the correct stage:" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Receptors", "Testing", "Stage"]}
[Test]
public async Task PostPerspectiveDetached_OnlyFiresAfterPerspective_VerifyDataFreshAsync() {
  // Arrange
  var completionSource = new TaskCompletionSource<ProductModel?>();
  var verifyingReceptor = new DataVerifyingReceptor(_productLens, completionSource);

  var registry = _host.Services.GetRequiredService<IReceptorRegistry>();
  registry.Register<ProductCreatedEvent>(verifyingReceptor, LifecycleStage.PostPerspectiveDetached);

  try {
    // Act
    var command = new CreateProductCommand("Widget", 9.99m);
    await _dispatcher.SendAsync(command);

    // Assert - Data is queryable because PostPerspectiveDetached fires AFTER flush
    var result = await completionSource.Task.WaitAsync(TimeSpan.FromSeconds(15));
    await Assert.That(result).IsNotNull();
    await Assert.That(result!.Name).IsEqualTo("Widget");
  } finally {
    registry.Unregister<ProductCreatedEvent>(verifyingReceptor, LifecycleStage.PostPerspectiveDetached);
  }
}

// Receptor that verifies data is available
internal sealed class DataVerifyingReceptor : IReceptor<ProductCreatedEvent> {
  private readonly IProductLens _lens;
  private readonly TaskCompletionSource<ProductModel?> _result;

  public DataVerifyingReceptor(IProductLens lens, TaskCompletionSource<ProductModel?> result) {
    _lens = lens;
    _result = result;
  }

  public async ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // This query works because we fire AFTER perspective flush!
    var product = await _lens.GetByIdAsync(evt.ProductId, ct);
    _result.TrySetResult(product);
  }
}
```

---

## Lifecycle Receptor Patterns

### Pattern 1: Metrics Collection

Track metrics after specific stages:

```csharp{title="Pattern 1: Metrics Collection" description="Track metrics after specific stages:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Pattern", "Metrics"]}
[FireAt(LifecycleStage.PostOutboxDetached)]
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

```csharp{title="Pattern 2: Audit Logging" description="Log message flow through pipeline:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Pattern", "Audit"]}
[FireAt(LifecycleStage.PreInboxInline)]
[FireAt(LifecycleStage.PostInboxDetached)]
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

```csharp{title="Pattern 3: Test Synchronization" description="Wait for perspective processing to complete:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Pattern", "Test"]}
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
      if (_context.PerspectiveType?.Name != _perspectiveName) {
        return ValueTask.CompletedTask;  // Not our perspective
      }
    }

    // Signal test to proceed
    _completionSource.TrySetResult(true);
    return ValueTask.CompletedTask;
  }
}
```

See [Lifecycle Synchronization](../../operations/testing/lifecycle-synchronization.md) for complete test patterns.

### Pattern 4: Custom Indexing

Build custom search indices after perspective updates:

```csharp{title="Pattern 4: Custom Indexing" description="Build custom search indices after perspective updates:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Pattern", "Custom"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
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

```csharp{title="Pattern 5: Cache Invalidation" description="Invalidate caches when perspectives update:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Pattern", "Cache"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
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
- Blocking operations in Detached stages
- Long-running operations in Inline stages

### Inline vs Detached Stages

**Inline stages block next step** - keep them extremely fast:
```csharp{title="Inline vs Detached Stages" description="Inline stages block next step - keep them extremely fast:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Inline", "Detached"]}
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

**Detached stages are fire-and-forget** (run in their own scope) - more flexible but still keep fast:
```csharp{title="Inline vs Detached Stages - DetachedMetricsReceptor" description="Detached stages are fire-and-forget - more flexible but still keep fast:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Inline", "Detached"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]  // Non-blocking
public class DetachedMetricsReceptor : IReceptor<IEvent> {
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

```csharp{title="Exception Handling" description="Lifecycle receptor errors are logged but don't fail message processing:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Exception", "Handling"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
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
```csharp{title="Exception Handling - CriticalReceptor" description="For critical operations, use Inline stages to detect failures:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Exception", "Handling"]}
[FireAt(LifecycleStage.PostPerspectiveInline)]  // Blocking - errors propagate
public class CriticalReceptor : IReceptor<IEvent> {
  public ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    // If this throws, the error propagates to the worker and blocks
    // this unit of work (the checkpoint cursor was already saved)
    // Use for critical operations only
    return ValueTask.CompletedTask;
  }
}
```

---

## Compile-Time vs Runtime Registration

| Feature | Compile-Time ([FireAt]) | Runtime (IReceptorRegistry) |
|---------|------------------------|-------------------------------------|
| **Registration** | Automatic via source generator | Manual via Register() |
| **Discovery** | Build-time | Runtime only |
| **Performance** | Fastest (pre-categorized entries) | Fast (delegate-based) |
| **Use Cases** | Production metrics, logging | Test synchronization |
| **Lifecycle** | Application lifetime | Scoped (register/unregister) |
| **Response Types** | ✅ Supported | ✅ Supported (results cascaded) |
| **AOT Compatible** | ✅ Yes | ✅ Yes (typed generics) |
| **Reflection** | ❌ Zero | ❌ Zero |

**Recommendation**:
- **Use [FireAt]** for production features (metrics, logging, auditing)
- **Use Registry** for test scenarios (wait for perspective completion)

---

## Registration Setup

### Production (Compile-Time)

**Step 1**: Apply `[FireAt]` to receptors:
```csharp{title="Production (Compile-Time)" description="Step 1: Apply [FireAt] to receptors:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Production", "Compile-Time"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
public class MyMetricsReceptor : IReceptor<ProductCreatedEvent> {
  public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct) {
    // Track metrics
    return ValueTask.CompletedTask;
  }
}
```

**Step 2**: Register Whizbang services:
```csharp{title="Production (Compile-Time) (2)" description="Step 2: Register Whizbang services:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Production", "Compile-Time"] unverified="DI registration wiring — configuration, no behavior to assert"}
// In Program.cs or Startup.cs
services
  .AddWhizbang()
  .WithEFCore<MyDbContext>()
  .WithDriver.Postgres;
```

**Done!** Source generators discover your receptors automatically.

### Testing (Runtime)

**Step 1**: Get registry from DI:
```csharp{title="Testing (Runtime)" description="Step 1: Get registry from DI:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Testing", "Runtime"]}
var registry = _host.Services.GetRequiredService<IReceptorRegistry>();
```

**Step 2**: Register receptor:
```csharp{title="Testing (Runtime) (2)" description="Step 2: Register receptor:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Testing", "Runtime"]}
var completionSource = new TaskCompletionSource<bool>();
var receptor = new PerspectiveCompletionReceptor<ProductCreatedEvent>(completionSource);

registry.Register<ProductCreatedEvent>(receptor, LifecycleStage.PostPerspectiveInline);
```

**Step 3**: Use and cleanup:
```csharp{title="Testing (Runtime) (3)" description="Step 3: Use and cleanup:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Testing", "Runtime"]}
try {
  await _dispatcher.SendAsync(command);
  await completionSource.Task.WaitAsync(TimeSpan.FromSeconds(15));
} finally {
  registry.Unregister<ProductCreatedEvent>(receptor, LifecycleStage.PostPerspectiveInline);
}
```

**Helper available** (Whizbang.Testing):
```csharp{title="Testing (Runtime) (4)" description="Helper available in Whizbang.Testing:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Testing", "Runtime"]}
// PerspectiveCompletionWaiter registers lifecycle receptors on creation
// and unregisters them on Dispose
using var waiter = new PerspectiveCompletionWaiter<ProductCreatedEvent>(
  inventoryRegistry, bffRegistry,
  inventoryPerspectives: 2, bffPerspectives: 1);

await dispatcher.SendAsync(new CreateProductCommand());
await waiter.WaitAsync();
```

See [Lifecycle Synchronization](../../operations/testing/lifecycle-synchronization.md) for complete patterns.

---

## Event Cascading {#event-cascading}

When receptors return messages (events or commands), Whizbang automatically cascades them to other receptors and/or the outbox. The `IEventCascader` interface handles this extraction and dispatch.

### How It Works

The `DispatcherEventCascader` implementation:

1. **Extracts messages** from receptor return values (tuples, arrays, Route wrappers)
2. **Applies routing** based on wrapper type and `[DefaultRouting]` attributes
3. **Dispatches** each message according to its routing configuration

```csharp{title="How It Works - CreateOrderHandler" description="How It Works - CreateOrderHandler" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Works"] tests=["ReceptorInvokerTests.InvokeAsync_ReceptorReturnsTupleWithEvents_ShouldCascadeAllEventsAsync", "ReceptorInvokerTests.InvokeAsync_ReceptorReturnsEvent_ShouldCascadeEventAsync"]}
// Receptor returns tuple with event - event is auto-cascaded
public class CreateOrderHandler : IReceptor<CreateOrderCommand, (OrderResult, OrderCreatedEvent)> {
  public ValueTask<(OrderResult, OrderCreatedEvent)> HandleAsync(
      CreateOrderCommand cmd,
      CancellationToken ct) {

    var result = new OrderResult(cmd.OrderId);
    var @event = new OrderCreatedEvent(cmd.OrderId);

    // Event is automatically cascaded to local receptors and/or outbox
    return ValueTask.FromResult((result, @event));
  }
}
```

### Routing Priority

Messages are routed based on priority (highest to lowest):

1. Message's `[DefaultRouting]` attribute
2. `Route.Local()` / `Route.Outbox()` / `Route.Both()` wrapper
3. Receptor's `[DefaultRouting]` attribute
4. System default: Outbox

### Security Context Inheritance

Cascaded messages inherit security context from the source envelope:

- Each cascaded message gets a new envelope
- The `SecurityContext` in the new envelope's initial hop is inherited from the source
- This ensures tenant/user context flows through message chains

### Route Wrappers

Control cascade routing explicitly:

```csharp{title="Route Wrappers" description="Control cascade routing explicitly:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Route", "Wrappers"]}
// Cascade to local receptors only
return (result, Route.Local(@event));

// Cascade to outbox only (cross-service)
return (result, Route.Outbox(@event));

// Cascade to both local and outbox
return (result, Route.Both(@event));

// Suppress cascading entirely
return (result, Route.None(@event));
```

See [Automatic Message Cascade](../dispatcher/dispatcher.md#automatic-message-cascade) for complete routing patterns.

---

## Related Topics

- [Lifecycle Stages](../lifecycle/lifecycle-stages.md) - All 24 stages with timing diagrams
- [Receptors Guide](receptors.md) - Core receptor concepts and patterns
- [Testing: Lifecycle Synchronization](../../operations/testing/lifecycle-synchronization.md) - Deterministic test patterns
- Source Generators - How lifecycle receptors are discovered
- AOT Compatibility - Zero-reflection design

---

## Summary

- **Reuse `IReceptor<TMessage>` interface** - No new interfaces to learn
- **`[FireAt]` controls timing** - Declarative lifecycle stage selection
- **Multiple attributes supported** - Fire at multiple stages
- **Default stages**: `LocalImmediateDetached`, `PostInboxDetached` (source-service filtering prevents double-fire)
- **Adding `[FireAt]` replaces defaults** - Receptor fires ONLY at specified stages
- **Two mutually exclusive paths**: Local (mediator) vs Distributed (outbox/inbox)
- **Optional `ILifecycleContext` injection** - Access metadata when needed
- **Scoped dependency support** - Receptors can inject `DbContext`, `IOrchestratorAgent`, etc.
- **Compile-time registration** - Source generators wire automatically via `IReceptorRegistry`
- **Runtime registration** - `IReceptorRegistry.Register()` for tests
- **Zero reflection** - Fully AOT-compatible via `IReceptorInvoker` (typed delegates)
- **Keep receptors fast** - < 5ms, avoid database queries in hot path
- **Use Inline stages carefully** - They block next step (for critical operations only)
