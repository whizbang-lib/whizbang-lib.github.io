# Message Security Context Propagation

Whizbang provides automatic security context establishment for incoming messages, ensuring that security identity flows across service boundaries in distributed systems.

## Overview

When messages arrive from external transports (Azure Service Bus, RabbitMQ, etc.), security context must be established **before** any business logic executes. The message security system:

- Extracts security information from message hops, payloads, or transport metadata
- Populates `IScopeContextAccessor.Current` for scoped services
- Invokes callbacks for custom service initialization
- Emits audit events for security compliance

## Architecture

```
Message Arrives
      │
      ▼
┌─────────────────────────────────────┐
│  IMessageSecurityContextProvider    │
│  (DefaultMessageSecurityContextProvider) │
└─────────────────────────────────────┘
      │
      ▼ Calls extractors in priority order
┌─────────────────────────────────────┐
│  ISecurityContextExtractor[]        │
│  • MessageHopSecurityExtractor (100)│
│  • JwtPayloadExtractor (200)        │
│  • TransportMetadataExtractor (300) │
└─────────────────────────────────────┘
      │
      ▼ First successful extraction wins
┌─────────────────────────────────────┐
│  ImmutableScopeContext              │
│  (wraps SecurityExtraction)         │
└─────────────────────────────────────┘
      │
      ├─▶ Populates IScopeContextAccessor.Current
      │
      ▼ Invokes callbacks
┌─────────────────────────────────────┐
│  ISecurityContextCallback[]         │
│  • UserContextManagerCallback       │
│  • AuditLogCallback                 │
└─────────────────────────────────────┘
```

## Quick Start

### Registration

```csharp
services.AddWhizbangMessageSecurity(options => {
  // AllowAnonymous defaults to FALSE (least privilege)
  // Must explicitly opt-in to allow anonymous messages
  options.AllowAnonymous = false;

  // Exempt specific message types
  options.ExemptMessageTypes.Add(typeof(HealthCheckMessage));
  options.ExemptMessageTypes.Add(typeof(SystemDiagnosticMessage));

  // Adjust timeout for slow token validation
  options.Timeout = TimeSpan.FromSeconds(10);
});

// Register custom extractors
services.AddSecurityExtractor<JdxMessageTokenExtractor>();

// Register callbacks
services.AddSecurityContextCallback<UserContextManagerCallback>();
```

### How It Works

When `ServiceBusConsumerWorker` receives a message:

1. Creates DI scope
2. Calls `IMessageSecurityContextProvider.EstablishContextAsync()`
3. Provider iterates through extractors in priority order (lower = earlier)
4. First successful extraction populates `IScopeContextAccessor.Current`
5. All callbacks are invoked with the established context
6. Business logic runs with security context available

## Configuration Options

```csharp
public sealed class MessageSecurityOptions {
  // When true, allows messages without security context.
  // DEFAULT: FALSE (least privilege - must explicitly enable)
  public bool AllowAnonymous { get; set; }

  // When true, logs security context establishment for audit.
  // DEFAULT: TRUE
  public bool EnableAuditLogging { get; set; } = true;

  // When true, extractors should validate tokens/credentials.
  // DEFAULT: TRUE
  public bool ValidateCredentials { get; set; } = true;

  // Maximum time to wait for security context establishment.
  // DEFAULT: 5 seconds
  public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(5);

  // Message types exempt from security requirements.
  public HashSet<Type> ExemptMessageTypes { get; } = new();

  // When true, propagates security context to cascaded events.
  // DEFAULT: TRUE
  public bool PropagateToOutgoingMessages { get; set; } = true;
}
```

## Built-in Extractors

### MessageHopSecurityExtractor (Priority: 100)

Extracts security context from the message envelope's hop chain. This is the default extractor for distributed message security propagation.

```csharp
// Message hops carry SecurityContext through the system
var hop = new MessageHop {
  ServiceInstance = serviceInstance,
  SecurityContext = new SecurityContext {
    TenantId = "tenant-123",
    UserId = "user-456"
  }
};

// MessageHopSecurityExtractor reads this automatically
```

**When to use**: Messages flowing between Whizbang services that already have security context attached to their hop chain.

## Custom Extractors

Create custom extractors for different security sources:

```csharp
public class JwtPayloadExtractor : ISecurityContextExtractor {
  public int Priority => 50;  // Runs before MessageHopSecurityExtractor

  public ValueTask<SecurityExtraction?> ExtractAsync(
    IMessageEnvelope envelope,
    MessageSecurityOptions options,
    CancellationToken cancellationToken = default) {

    // Check if payload contains JWT token
    if (envelope.Payload is not IJdxMessage jdxMessage ||
        string.IsNullOrEmpty(jdxMessage.Token)) {
      return ValueTask.FromResult<SecurityExtraction?>(null);
    }

    // Decode and validate JWT
    var claims = DecodeJwt(jdxMessage.Token, options.ValidateCredentials);

    return ValueTask.FromResult<SecurityExtraction?>(new SecurityExtraction {
      Scope = new PerspectiveScope {
        TenantId = claims["tenant_id"],
        UserId = claims["sub"]
      },
      Roles = claims["roles"]?.Split(',').ToHashSet() ?? new HashSet<string>(),
      Permissions = new HashSet<Permission>(),
      SecurityPrincipals = new HashSet<SecurityPrincipalId>(),
      Claims = claims,
      Source = "JwtPayload"
    });
  }
}
```

## Security Context Callbacks

Callbacks run **after** security context is established but **before** business logic (receptors) execute. This enables custom service initialization at exactly the right time.

### ISecurityContextCallback Interface

```csharp
public interface ISecurityContextCallback {
  ValueTask OnContextEstablishedAsync(
    IScopeContext context,
    IMessageEnvelope envelope,
    IServiceProvider scopedProvider,
    CancellationToken cancellationToken = default);
}
```

### Callback Execution Points

:::new
Callbacks are now invoked at ALL security establishment points (v1.0.0)
:::

Callbacks are invoked at **three key points** in the message processing pipeline:

| Execution Point | Component | When |
|----------------|-----------|------|
| **Message Arrival** | `ServiceBusConsumerWorker` | When message arrives from transport |
| **Lifecycle Processing** | `PerspectiveWorker` | Before each lifecycle stage receptor |
| **Receptor Execution** | `ReceptorInvoker` | Before each receptor invocation |

This ensures your custom services have security context available regardless of **where** the receptor executes.

### Execution Sequence Diagram

```
HTTP Request or Message Arrival
         │
         ▼
┌────────────────────────────────────────┐
│ Security Context Establishment         │
│ (Extractors run in priority order)     │
└────────────────────┬───────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│ ISecurityContextCallback.              │
│ OnContextEstablishedAsync()            │◀── YOUR CALLBACK RUNS HERE
│                                        │
│ • UserContextManager initialized       │
│ • Tenant config loaded                 │
│ • Custom services populated            │
└────────────────────┬───────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│ Receptor / Handler Executes            │◀── BUSINESS LOGIC RUNS HERE
│                                        │
│ • IMessageContext.TenantId available   │
│ • IScopeContextAccessor.Current ready  │
│ • UserContextManager ready (if used)   │
└────────────────────────────────────────┘
```

**Key insight**: Callbacks complete **before** any receptor code runs, so your services are fully initialized when business logic needs them.

### Example: UserContextManager Integration

```csharp
public class UserContextManagerCallback : ISecurityContextCallback {
  private readonly UserContextManager _userContextManager;

  public UserContextManagerCallback(UserContextManager userContextManager) {
    _userContextManager = userContextManager;
  }

  public ValueTask OnContextEstablishedAsync(
    IScopeContext context,
    IMessageEnvelope envelope,
    IServiceProvider scopedProvider,
    CancellationToken cancellationToken = default) {

    // Populate UserContextManager from Whizbang security context
    if (context?.Scope != null) {
      _userContextManager.SetFromScopeContext(
        tenantId: context.Scope.TenantId,
        userId: context.Scope.UserId
      );
    }

    return ValueTask.CompletedTask;
  }
}

// Register in DI
services.AddScoped<ISecurityContextCallback, UserContextManagerCallback>();
```

### When to Use Callbacks vs Direct Injection

| Scenario | Approach | Why |
|----------|----------|-----|
| Simple TenantId/UserId access | **IMessageContext** | Direct, no setup needed |
| Check roles or permissions | **IScopeContextAccessor** | Full scope access |
| Initialize custom service state | **ISecurityContextCallback** | Runs before receptors |
| Load tenant configuration | **ISecurityContextCallback** | Centralized initialization |
| Legacy service integration | **ISecurityContextCallback** | Bridge to existing patterns |
| Stateless receptor | **IMessageContext** | Simplest approach |

### Multiple Callbacks

You can register multiple callbacks. They execute in registration order:

```csharp
// Multiple callbacks for different concerns
services.AddScoped<ISecurityContextCallback, UserContextManagerCallback>();
services.AddScoped<ISecurityContextCallback, TenantConfigurationCallback>();
services.AddScoped<ISecurityContextCallback, AuditLogCallback>();
```

### Callback Registration

```csharp
// Option 1: Extension method (recommended)
services.AddSecurityContextCallback<UserContextManagerCallback>();

// Option 2: Direct registration
services.AddScoped<ISecurityContextCallback, UserContextManagerCallback>();
```

## Transport Metadata

For extracting security from transport-level headers (e.g., Azure Service Bus application properties):

```csharp
public class ServiceBusMetadataExtractor : ISecurityContextExtractor {
  public int Priority => 300;

  public ValueTask<SecurityExtraction?> ExtractAsync(
    IMessageEnvelope envelope,
    MessageSecurityOptions options,
    CancellationToken cancellationToken = default) {

    // Access transport metadata if available
    if (envelope is not ITransportMetadataAware metadataAware ||
        metadataAware.TransportMetadata is not ServiceBusTransportMetadata metadata) {
      return ValueTask.FromResult<SecurityExtraction?>(null);
    }

    // Extract from Service Bus application properties
    var tenantId = metadata.GetProperty<string>("X-Tenant-Id");
    var userId = metadata.GetProperty<string>("X-User-Id");

    if (string.IsNullOrEmpty(tenantId) && string.IsNullOrEmpty(userId)) {
      return ValueTask.FromResult<SecurityExtraction?>(null);
    }

    return ValueTask.FromResult<SecurityExtraction?>(new SecurityExtraction {
      Scope = new PerspectiveScope {
        TenantId = tenantId,
        UserId = userId
      },
      Roles = new HashSet<string>(),
      Permissions = new HashSet<Permission>(),
      SecurityPrincipals = new HashSet<SecurityPrincipalId>(),
      Claims = new Dictionary<string, string>(),
      Source = "ServiceBusMetadata"
    });
  }
}
```

## Security Failure Handling

When `AllowAnonymous` is `false` (default) and no extractor can establish context:

```csharp
// SecurityContextRequiredException is thrown
try {
  await provider.EstablishContextAsync(envelope, scopedProvider, ct);
} catch (SecurityContextRequiredException ex) {
  // ex.MessageType contains the message type that required security
  logger.LogWarning(
    "Security context required for {MessageType} but none established",
    ex.MessageType?.Name);

  // Message will be dead-lettered or rejected
  throw;
}
```

## Audit Events

When `EnableAuditLogging` is `true`, a `ScopeContextEstablished` system event is emitted:

```csharp
public sealed record ScopeContextEstablished : ISystemEvent {
  public required PerspectiveScope Scope { get; init; }
  public required IReadOnlySet<string> Roles { get; init; }
  public required IReadOnlySet<Permission> Permissions { get; init; }
  public required string Source { get; init; }  // "MessageHop", "JwtPayload", etc.
  public required DateTimeOffset Timestamp { get; init; }
}
```

## ImmutableScopeContext

The established security context is wrapped in `ImmutableScopeContext`, which provides:

- **Immutability**: Cannot be modified after establishment
- **Source tracking**: Which extractor created it
- **Timestamp**: When it was established
- **Propagation flag**: Whether to include in outgoing messages

```csharp
var context = await provider.EstablishContextAsync(envelope, scopedProvider, ct);

if (context is ImmutableScopeContext immutable) {
  Console.WriteLine($"Source: {immutable.Source}");
  Console.WriteLine($"Established: {immutable.EstablishedAt}");
  Console.WriteLine($"Propagate: {immutable.ShouldPropagate}");
}
```

## Automatic Security Propagation

When `MessageSecurityOptions.PropagateToOutgoingMessages` is `true` (the default), the Dispatcher automatically attaches security context from the ambient scope to all outgoing message hops:

1. **Dispatcher checks** `IScopeContextAccessor.Current` for an established security context
2. **If** `ImmutableScopeContext.ShouldPropagate` is `true`, extracts `UserId` and `TenantId`
3. **Populates** `MessageHop.SecurityContext` on all outgoing envelopes
4. **Downstream services** extract via `MessageHopSecurityExtractor`

This enables seamless security context flow across service boundaries without manual propagation.

### Default Registration

`AddWhizbangDispatcher()` automatically registers `IScopeContextAccessor` by default, enabling security propagation without additional configuration:

```csharp
// IScopeContextAccessor is registered automatically
services.AddWhizbangDispatcher();

// You can override with your own implementation if needed
services.AddSingleton<IScopeContextAccessor, CustomScopeContextAccessor>();
services.AddWhizbangDispatcher(); // Uses your implementation (TryAddSingleton)
```

To disable security propagation, set `ShouldPropagate = false` when creating `ImmutableScopeContext`.

### How It Works

```csharp
// When a message is sent, the Dispatcher:
// 1. Reads IScopeContextAccessor.Current
// 2. If ImmutableScopeContext with ShouldPropagate=true, extracts security info
// 3. Attaches to outgoing MessageHop

var hop = new MessageHop {
  Type = HopType.Current,
  ServiceInstance = serviceInstance,
  SecurityContext = new SecurityContext {
    UserId = scopeContext.Scope.UserId,
    TenantId = scopeContext.Scope.TenantId
  }
};
```

### Controlling Propagation

Propagation can be controlled at multiple levels:

```csharp
// 1. Globally via MessageSecurityOptions (default: true)
services.AddWhizbangMessageSecurity(options => {
  options.PropagateToOutgoingMessages = true;  // default
});

// 2. Per-context via ImmutableScopeContext
var extraction = new SecurityExtraction { /* ... */ };

// Propagation enabled - security flows to downstream services
var propagate = new ImmutableScopeContext(extraction, shouldPropagate: true);

// Propagation disabled - security stays local
var local = new ImmutableScopeContext(extraction, shouldPropagate: false);
```

### End-to-End Flow

```
Service A (HTTP Request)          Service B (Message Consumer)
┌─────────────────────────┐       ┌─────────────────────────┐
│ WhizbangScopeMiddleware │       │ ServiceBusConsumerWorker│
│ establishes IScopeContext│       │                         │
└───────────┬─────────────┘       └───────────┬─────────────┘
            │                                 │
            ▼                                 │
┌───────────────────────────┐                 │
│ Business logic calls      │                 │
│ dispatcher.SendAsync()    │                 │
└───────────┬───────────────┘                 │
            │                                 │
            ▼ Dispatcher attaches security    │
┌───────────────────────────┐                 │
│ MessageHop.SecurityContext│                 │
│ = { UserId, TenantId }    │ ───Message───▶ │
└───────────────────────────┘                 │
                                              ▼
                              ┌───────────────────────────┐
                              │ MessageHopSecurityExtractor│
                              │ reads SecurityContext      │
                              └───────────┬───────────────┘
                                          │
                                          ▼
                              ┌───────────────────────────┐
                              │ IScopeContextAccessor     │
                              │ .Current = context        │
                              └───────────────────────────┘
```

## Explicit Security Context API

For system-triggered operations (timers, schedulers) or impersonation scenarios, use the explicit security context API:

### AsSystem() - System Operations

Use `AsSystem()` when dispatching messages from system contexts where no user identity exists, or when a user-initiated action should run with system privileges:

```csharp
// Timer/scheduler with no user context
await dispatcher.AsSystem().SendAsync(new ReseedSystemEvent());
// Audit: ContextType=System, ActualPrincipal=null, EffectivePrincipal="SYSTEM"

// Admin triggering system operation (preserves who triggered it)
await dispatcher.AsSystem().SendAsync(new ReseedSystemEvent());
// Audit: ContextType=System, ActualPrincipal="admin@example.com", EffectivePrincipal="SYSTEM"
```

Key behaviors:
- `EffectivePrincipal` is always set to `"SYSTEM"`
- `ActualPrincipal` captures the current user if one exists (for audit trail)
- `ContextType` is set to `SecurityContextType.System`
- Previous security context is restored after dispatch completes

### RunAs() - Impersonation

Use `RunAs()` when a user needs to perform actions as another identity, with full audit trail:

```csharp
// Support staff impersonating a user (full audit trail)
await dispatcher.RunAs("target-user@example.com").SendAsync(command);
// Audit: ContextType=Impersonated, ActualPrincipal="support@example.com", EffectivePrincipal="target-user@example.com"
```

Key behaviors:
- `EffectivePrincipal` is set to the specified identity
- `ActualPrincipal` captures who initiated the impersonation
- `ContextType` is set to `SecurityContextType.Impersonated`
- Both identities are captured for security auditing

### Supported Methods

The security builder supports all dispatch methods:

```csharp
// Send commands
await dispatcher.AsSystem().SendAsync(command);
await dispatcher.AsSystem().SendAsync(command, options);
await dispatcher.AsSystem().SendAsync(command, messageContext);

// Local invoke (in-process)
await dispatcher.AsSystem().LocalInvokeAsync<TMessage, TResult>(message);
await dispatcher.AsSystem().LocalInvokeAsync(message);

// Publish events
await dispatcher.AsSystem().PublishAsync(eventData);
```

### Audit Trail

The explicit security API provides complete audit trail information:

| Scenario | ContextType | ActualPrincipal | EffectivePrincipal |
|----------|-------------|-----------------|-------------------|
| Timer job (no user) | System | null | SYSTEM |
| Admin runs as system | System | admin@example.com | SYSTEM |
| Support impersonates | Impersonated | support@example.com | target-user |
| Normal user | User | user@example.com | user@example.com |

### SecurityContextType Enum

```csharp
public enum SecurityContextType {
  User,           // Normal user context from HTTP/message
  System,         // System-initiated (no user involved)
  Impersonated,   // User running as different identity
  ServiceAccount  // Service-to-service with service identity
}
```

### Context Propagation

The explicit security context is propagated to outgoing message hops when `ImmutableScopeContext.ShouldPropagate` is `true` (the default for explicit contexts). This ensures downstream services receive the security context:

```csharp
// This message will carry SYSTEM context to downstream services
await dispatcher.AsSystem().SendAsync(new MaintenanceCommand());
```

### Design Principles

1. **No implicit fallback to elevated** - Code must explicitly request system or elevated context
2. **Full audit trail** - Both actual and effective identities are always captured
3. **Context restoration** - Previous context is restored after dispatch completes (try/finally)
4. **Authorization not bypassed** - This only sets context, not permissions

## Integration with Existing Security

This message security system complements existing security tools:

| Existing Tool | Relationship |
|--------------|--------------|
| **IScopeContext/Accessor** | Provider populates this - single source of truth |
| **WhizbangScopeMiddleware** | HTTP equivalent; this is the message equivalent |
| **MessageHop.SecurityContext** | Default extractor reads from this |
| **PerspectiveScope** | Included in IScopeContext.Scope |
| **Scoped Lens Factory** | Reads from IScopeContextAccessor (works automatically) |
| **System Events** | Provider emits `ScopeContextEstablished` for audit |

## AOT Compatibility

The message security system is fully AOT-compatible:

- No reflection for extractor/callback discovery
- Explicit generic registration: `AddSecurityExtractor<T>()`
- `[DynamicallyAccessedMembers]` attributes on generic constraints
- All type resolution at compile time

## Related Documentation

- [Security System](./security.md) - Permissions, roles, and scope context
- [Scoping](./scoping.md) - PerspectiveScope and multi-tenancy
- [System Events](./system-events.md) - Audit events
- [Transport Consumer](./transport-consumer.md) - Message processing workers
