# Message Security Context Propagation

Whizbang provides automatic security context establishment for incoming messages, ensuring that security identity flows across service boundaries in distributed systems.

## Overview {#overview}

When messages arrive from external transports (Azure Service Bus, RabbitMQ, etc.), security context must be established **before** any business logic executes. The message security system:

- Extracts security information from message hops, payloads, or transport metadata
- Populates `IScopeContextAccessor.Current` for scoped services
- Invokes callbacks for custom service initialization
- Emits audit events for security compliance

## Architecture {#architecture}

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

## Quick Start {#quick-start}

### Extraction {#extraction}

The message security system uses a provider/extractor pattern to establish security context from incoming messages. The `IMessageSecurityContextProvider` orchestrates multiple `ISecurityContextExtractor` implementations in priority order until one successfully extracts security information.

**Key Concepts**:
- **Provider**: Coordinates extractors and establishes the security context
- **Extractors**: Each attempts to extract security from a specific source (hops, JWT, transport metadata)
- **Priority**: Lower numbers run first (100, 200, 300, etc.)
- **First Wins**: The first successful extraction establishes the context

### Registration {#registration}

```csharp{title="Registration" description="Demonstrates registration" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Registration"]}
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

### Explicit Security Context API {#explicit-security-context-api}

For system-triggered operations or impersonation scenarios, use the explicit security context API. This is documented in detail in the [Explicit Security Context API](#explicit-context) section below.

### Security Context Helper {#security-context-helper}

The `IMessageSecurityContextProvider` provides helper methods for establishing security context from different sources. The provider coordinates extractors and manages the context lifecycle.

### Scoped Message Context {#scoped-message-context}

When `ServiceBusConsumerWorker` receives a message:

1. Creates DI scope
2. Calls `IMessageSecurityContextProvider.EstablishContextAsync()`
3. Provider iterates through extractors in priority order (lower = earlier)
4. First successful extraction populates `IScopeContextAccessor.Current`
5. All callbacks are invoked with the established context
6. Business logic runs with security context available

## Configuration Options {#configuration}

```csharp{title="Configuration Options" description="Demonstrates configuration Options" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Configuration", "Options"]}
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

## Immutable Context {#immutable-context}

The established security context is wrapped in `ImmutableScopeContext`, which provides:

- **Immutability**: Cannot be modified after establishment
- **Source tracking**: Which extractor created it
- **Timestamp**: When it was established
- **Propagation flag**: Whether to include in outgoing messages

```csharp{title="Immutable Context" description="- Immutability: Cannot be modified after establishment - Source tracking: Which extractor created it - Timestamp: When" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Immutable", "Context"]}
var context = await provider.EstablishContextAsync(envelope, scopedProvider, ct);

if (context is ImmutableScopeContext immutable) {
  Console.WriteLine($"Source: {immutable.Source}");
  Console.WriteLine($"Established: {immutable.EstablishedAt}");
  Console.WriteLine($"Propagate: {immutable.ShouldPropagate}");
}
```

See the [ImmutableScopeContext](#immutable-scope-context) section below for full details.

## Built-in Extractors {#extractors}

### MessageHopSecurityExtractor (Priority: 100)

Extracts security context from the message envelope's hop chain. This is the default extractor for distributed message security propagation.

```csharp{title="MessageHopSecurityExtractor (Priority: 100)" description="Extracts security context from the message envelope's hop chain." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "MessageHopSecurityExtractor", "Priority:"]}
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

### Message Hop Extractor {#message-hop-extractor}

The `MessageHopSecurityExtractor` is the default built-in extractor that reads security context from message hop chains. It runs with priority 100 (early in the extraction pipeline).

**How it works**:

1. Examines the message envelope's hop chain
2. Looks for the most recent hop with a `SecurityContext` populated
3. Extracts `TenantId`, `UserId`, and other scope information
4. Creates a `SecurityExtraction` with the found values

**Example**:

```csharp{title="Message Hop Extractor" description="Demonstrates message Hop Extractor" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Message", "Hop"]}
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

## Custom Extractors {#custom-extractors}

Create custom extractors for different security sources:

```csharp{title="Custom Extractors" description="Create custom extractors for different security sources:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Custom", "Extractors"]}
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

## Security Context Callbacks {#callbacks}

Callbacks run **after** security context is established but **before** business logic (receptors) execute. This enables custom service initialization at exactly the right time.

### ISecurityContextCallback Interface

```csharp{title="ISecurityContextCallback Interface" description="Demonstrates iSecurityContextCallback Interface" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "ISecurityContextCallback", "Interface"]}
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

```csharp{title="Example: UserContextManager Integration" description="Demonstrates example: UserContextManager Integration" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Example:", "UserContextManager"]}
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

```csharp{title="Multiple Callbacks" description="You can register multiple callbacks." category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Multiple", "Callbacks"]}
// Multiple callbacks for different concerns
services.AddScoped<ISecurityContextCallback, UserContextManagerCallback>();
services.AddScoped<ISecurityContextCallback, TenantConfigurationCallback>();
services.AddScoped<ISecurityContextCallback, AuditLogCallback>();
```

### Callback Registration

```csharp{title="Callback Registration" description="Demonstrates callback Registration" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Callback", "Registration"]}
// Option 1: Extension method (recommended)
services.AddSecurityContextCallback<UserContextManagerCallback>();

// Option 2: Direct registration
services.AddScoped<ISecurityContextCallback, UserContextManagerCallback>();
```

## Security Context in Event Cascades {#security-context-in-event-cascades}

When events are cascaded from receptor return values (auto-cascade), security context automatically propagates from the source envelope to the new DI scope created for receptor execution. This ensures downstream receptors have access to the original user and tenant context.

### Cascade Flow Diagram

```
HTTP Request (UserId: user@test.com, TenantId: tenant-123)
    ↓
Command Handler (security context established by message security system)
    │ (IMessageContext available: UserId, TenantId)
    ↓
Returns Event (OrderCreated)
    ↓
Auto-Cascade via GetUntypedReceptorPublisher
    │
    ├─▶ Creates new DI scope
    │
    ├─▶ SecurityContextHelper.EstablishFullContextAsync(sourceEnvelope, scope.ServiceProvider)
    │   │
    │   ├─▶ Extracts security from envelope hops
    │   ├─▶ Sets IScopeContextAccessor.Current
    │   └─▶ Invokes ISecurityContextCallback[] (UserContextManager, etc.)
    │
    ├─▶ Resolves receptors from new scope
    │
    └─▶ Event Receptors execute
        │ (IMessageContext available: UserId = user@test.com, TenantId = tenant-123)
        └─▶ UserContextManager.TenantContext is populated
```

### How It Works

The generated `GetUntypedReceptorPublisher` method (created by source generators) ensures security context flows through cascades:

```csharp{title="How It Works" description="The generated GetUntypedReceptorPublisher method (created by source generators) ensures security context flows through" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Works"]}
// Generated by Whizbang.Generators
protected override Func<object, IMessageEnvelope?, CancellationToken, Task>?
    GetUntypedReceptorPublisher(Type eventType) {

    if (eventType == typeof(OrderCreated)) {
        async Task PublishToReceptorsUntyped(
            object evt,
            IMessageEnvelope? sourceEnvelope,
            CancellationToken cancellationToken) {

            // Step 1: Create isolated DI scope for cascade execution
            var scope = _scopeFactory.CreateScope();
            try {
                // Step 2: Establish security context from source envelope
                if (sourceEnvelope is not null) {
                    await SecurityContextHelper.EstablishFullContextAsync(
                        sourceEnvelope,
                        scope.ServiceProvider,
                        cancellationToken);
                }

                // Step 3: Resolve receptors with populated security context
                var receptors = scope.ServiceProvider
                    .GetServices<IReceptor<OrderCreated>>();

                // Step 4: Invoke receptors (IMessageContext.UserId/TenantId available)
                foreach (var receptor in receptors) {
                    await receptor.HandleAsync((OrderCreated)evt, cancellationToken);
                }
            } finally {
                await scope.DisposeAsync();
            }
        }

        return PublishToReceptorsUntyped;
    }
    // ... other event types
}
```

### Example: Context Flow Through Cascade

```csharp{title="Example: Context Flow Through Cascade" description="Demonstrates example: Context Flow Through Cascade" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Example:", "Context"]}
// 1. Command receptor returns event
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IMessageContext _context;

    public CreateOrderReceptor(IMessageContext context) {
        _context = context;
    }

    public ValueTask<OrderCreated> HandleAsync(CreateOrder cmd) {
        // ✅ Context available: _context.UserId, _context.TenantId
        var userId = _context.UserId;
        var tenantId = _context.TenantId;

        return ValueTask.FromResult(new OrderCreated(cmd.OrderId));
    }
}

// 2. Event cascades to OrderCreatedReceptor
public class OrderCreatedReceptor : IReceptor<OrderCreated> {
    private readonly IMessageContext _context;
    private readonly UserContextManager _userContext;

    public OrderCreatedReceptor(
        IMessageContext context,
        UserContextManager userContext) {
        _context = context;
        _userContext = userContext;
    }

    public ValueTask HandleAsync(OrderCreated evt) {
        // ✅ Security context AUTOMATICALLY propagated!
        //    _context.UserId = same as command handler
        //    _context.TenantId = same as command handler
        //    _userContext.TenantContext is populated

        var userId = _context.UserId;  // ✅ Available
        var tenantId = _context.TenantId;  // ✅ Available

        return ValueTask.CompletedTask;
    }
}
```

### Nested Dispatch Context Inheritance

Security context flows through nested dispatches from cascaded receptors:

```csharp{title="Nested Dispatch Context Inheritance" description="Security context flows through nested dispatches from cascaded receptors:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Nested", "Dispatch"]}
public class OrderCreatedReceptor : IReceptor<OrderCreated> {
    private readonly IDispatcher _dispatcher;
    private readonly IMessageContext _context;

    public OrderCreatedReceptor(
        IDispatcher dispatcher,
        IMessageContext context) {
        _dispatcher = dispatcher;
        _context = context;
    }

    public async ValueTask HandleAsync(OrderCreated evt) {
        // ✅ This receptor has security context from cascade
        var userId = _context.UserId;
        var tenantId = _context.TenantId;

        // Dispatch nested command - inherits security context
        await _dispatcher.SendAsync(new SendOrderConfirmation(evt.OrderId));

        // ✅ SendOrderConfirmation receptor will ALSO have security context!
    }
}
```

### Null Envelope Scenarios

Some cascade paths don't have a source envelope:

| Scenario | Source Envelope | Context Available? |
|----------|----------------|-------------------|
| HTTP → Command → Event Cascade | ✅ Yes | ✅ Yes |
| Timer/Scheduler → Command | ❌ No | ❌ No (system context) |
| RPC `LocalInvokeAsync` cascade | ❌ No | ❌ No |
| Manual `CascadeMessageAsync(msg, sourceEnvelope: null)` | ❌ No | ❌ No |

**For system-initiated operations**, use explicit security context API:

```csharp{title="Null Envelope Scenarios" description="For system-initiated operations, use explicit security context API:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Null", "Envelope"]}
// Timer/scheduler scenario - establish system context explicitly
await _dispatcher.AsSystem().SendAsync(new ScheduledCleanupCommand());
```

### Key Points

- **Automatic propagation**: Security context flows through cascades without manual intervention
- **New scope per cascade**: Each cascade creates an isolated DI scope with fresh context establishment
- **Callback invocation**: `ISecurityContextCallback[]` (UserContextManager, audit, etc.) execute in new scope
- **AOT compatible**: Zero reflection, compile-time type-switch dispatch via source generators
- **Transitive flow**: Nested dispatches from cascaded receptors inherit security context

:::new
**New**: Security context now automatically propagates through all cascade paths, enabling cascaded receptors to access user and tenant context from the original request.
:::

## Message Context Accessor {#message-context-accessor}

The `IMessageContext` interface provides direct access to security information from the current message being processed. This is a simpler alternative to `IScopeContextAccessor` when you only need basic TenantId/UserId access.

```csharp{title="Message Context Accessor" description="The IMessageContext interface provides direct access to security information from the current message being processed." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Message", "Context"]}
public interface IMessageContext {
  string? TenantId { get; }
  string? UserId { get; }
  string? OrganizationId { get; }
  string? CustomerId { get; }
}

// Usage in a receptor
public class OrderReceptor : IReceptor<CreateOrder> {
  private readonly IMessageContext _messageContext;

  public OrderReceptor(IMessageContext messageContext) {
    _messageContext = messageContext;
  }

  public async Task ReceiveAsync(CreateOrder message, CancellationToken ct) {
    var tenantId = _messageContext.TenantId;
    var userId = _messageContext.UserId;
    // Process message with security context
  }
}
```

## Default Provider {#default-provider}

The `DefaultMessageSecurityContextProvider` is the built-in implementation of `IMessageSecurityContextProvider`. It orchestrates the extraction process:

1. **Resolves extractors** from DI (all `ISecurityContextExtractor` registrations)
2. **Sorts by priority** (lower numbers first)
3. **Iterates extractors** until one returns a non-null `SecurityExtraction`
4. **Wraps result** in `ImmutableScopeContext`
5. **Sets accessor** (`IScopeContextAccessor.Current = context`)
6. **Invokes callbacks** (all `ISecurityContextCallback` registrations)

**Registration**:

```csharp{title="Default Provider" description="Registration:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Default", "Provider"]}
// Automatically registered by AddWhizbangMessageSecurity
services.AddWhizbangMessageSecurity();

// Or manually
services.AddSingleton<IMessageSecurityContextProvider, DefaultMessageSecurityContextProvider>();
```

## Service Bus Metadata {#service-bus-metadata}

For Azure Service Bus, transport metadata can be accessed via the `ITransportMetadataAware` interface:

```csharp{title="Service Bus Metadata" description="For Azure Service Bus, transport metadata can be accessed via the ITransportMetadataAware interface:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Service", "Bus"]}
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

## Transport Metadata {#transport-metadata}

For extracting security from transport-level headers (e.g., Azure Service Bus application properties):

```csharp{title="Transport Metadata" description="For extracting security from transport-level headers (e." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Transport", "Metadata"]}
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

## Exceptions {#exceptions}

The message security system defines specific exceptions for security failures:

### SecurityContextRequiredException

Thrown when a message requires security context but none could be established:

```csharp{title="SecurityContextRequiredException" description="Thrown when a message requires security context but none could be established:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "SecurityContextRequiredException"]}
public class SecurityContextRequiredException : Exception {
  public Type? MessageType { get; init; }

  public SecurityContextRequiredException(Type? messageType)
    : base($"Security context required for {messageType?.Name ?? "message"} but none established") {
    MessageType = messageType;
  }
}
```

### Handling Security Exceptions

```csharp{title="Handling Security Exceptions" description="Demonstrates handling Security Exceptions" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Handling", "Exceptions"]}
try {
  await provider.EstablishContextAsync(envelope, scopedProvider, ct);
} catch (SecurityContextRequiredException ex) {
  logger.LogWarning(
    "Security context required for {MessageType} but none established",
    ex.MessageType?.Name);
  // Message will be dead-lettered or rejected
  throw;
}
```

## Envelope Reconstruction {#envelope-reconstruction}

When messages are reconstructed from transport (deserialization), the security context must be re-established. The `IMessageEnvelope` provides access to:

- **Hops**: Message hop chain with security context
- **Payload**: The actual message (may contain security tokens)
- **Transport Metadata**: Transport-specific headers and properties

**Example**:

```csharp{title="Envelope Reconstruction" description="Demonstrates envelope Reconstruction" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Envelope", "Reconstruction"]}
// Envelope reconstruction preserves security information
var envelope = new MessageEnvelope {
  MessageId = messageId,
  Payload = deserializedMessage,
  Hops = deserializedHops,  // Contains SecurityContext
  TransportMetadata = serviceBusMetadata
};

// Extractors can read from all these sources
await provider.EstablishContextAsync(envelope, scopedProvider, ct);
```

## Cross-Tenant Operations {#cross-tenant-operations}

By default, security context is tenant-scoped. For cross-tenant operations (admin, reporting), use explicit security context:

```csharp{title="Cross-Tenant Operations" description="By default, security context is tenant-scoped." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Cross-Tenant", "Operations"]}
// Admin cross-tenant query
await dispatcher.AsSystem().SendAsync(new GenerateTenantReport {
  TargetTenantId = "other-tenant"
});
// Audit: ContextType=System, EffectivePrincipal="SYSTEM"

// Or with specific tenant context
var extraction = new SecurityExtraction {
  Scope = new PerspectiveScope { TenantId = "other-tenant" },
  // ... permissions for cross-tenant access
};
var context = new ImmutableScopeContext(extraction, shouldPropagate: true);
scopeAccessor.Current = context;
```

## Security Failure Handling {#failure-handling}

When `AllowAnonymous` is `false` (default) and no extractor can establish context:

```csharp{title="Security Failure Handling" description="When AllowAnonymous is false (default) and no extractor can establish context:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Failure", "Handling"]}
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

## Audit Events {#audit-events}

When `EnableAuditLogging` is `true`, a `ScopeContextEstablished` system event is emitted:

```csharp{title="Audit Events" description="When EnableAuditLogging is true, a ScopeContextEstablished system event is emitted:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Audit", "Events"]}
public sealed record ScopeContextEstablished : ISystemEvent {
  public required PerspectiveScope Scope { get; init; }
  public required IReadOnlySet<string> Roles { get; init; }
  public required IReadOnlySet<Permission> Permissions { get; init; }
  public required string Source { get; init; }  // "MessageHop", "JwtPayload", etc.
  public required DateTimeOffset Timestamp { get; init; }
}
```

## ImmutableScopeContext {#immutable-scope-context}

The established security context is wrapped in `ImmutableScopeContext`, which provides:

- **Immutability**: Cannot be modified after establishment
- **Source tracking**: Which extractor created it
- **Timestamp**: When it was established
- **Propagation flag**: Whether to include in outgoing messages

```csharp{title="ImmutableScopeContext" description="- Immutability: Cannot be modified after establishment - Source tracking: Which extractor created it - Timestamp: When" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "ImmutableScopeContext", "Immutable-scope-context"]}
var context = await provider.EstablishContextAsync(envelope, scopedProvider, ct);

if (context is ImmutableScopeContext immutable) {
  Console.WriteLine($"Source: {immutable.Source}");
  Console.WriteLine($"Established: {immutable.EstablishedAt}");
  Console.WriteLine($"Propagate: {immutable.ShouldPropagate}");
}
```

## Automatic Security Propagation {#propagation}

When `MessageSecurityOptions.PropagateToOutgoingMessages` is `true` (the default), the Dispatcher automatically attaches security context from the ambient scope to all outgoing message hops:

1. **Dispatcher checks** `IScopeContextAccessor.Current` for an established security context
2. **If** `ImmutableScopeContext.ShouldPropagate` is `true`, extracts `UserId` and `TenantId`
3. **Populates** `MessageHop.SecurityContext` on all outgoing envelopes
4. **Downstream services** extract via `MessageHopSecurityExtractor`

This enables seamless security context flow across service boundaries without manual propagation.

### Default Registration

`AddWhizbangDispatcher()` automatically registers `IScopeContextAccessor` by default, enabling security propagation without additional configuration:

```csharp{title="Default Registration" description="AddWhizbangDispatcher() automatically registers IScopeContextAccessor by default, enabling security propagation without" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Default", "Registration"]}
// IScopeContextAccessor is registered automatically
services.AddWhizbangDispatcher();

// You can override with your own implementation if needed
services.AddSingleton<IScopeContextAccessor, CustomScopeContextAccessor>();
services.AddWhizbangDispatcher(); // Uses your implementation (TryAddSingleton)
```

To disable security propagation, set `ShouldPropagate = false` when creating `ImmutableScopeContext`.

### How It Works

```csharp{title="How It Works (2)" description="Demonstrates how It Works" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Works"]}
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

```csharp{title="Controlling Propagation" description="Propagation can be controlled at multiple levels:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Controlling", "Propagation"]}
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

## Explicit Security Context API {#explicit-context}

For system-triggered operations (timers, schedulers) or impersonation scenarios, use the explicit security context API:

### AsSystem() - System Operations {#as-system}

Use `AsSystem()` when dispatching messages from system contexts where no user identity exists, or when a user-initiated action should run with system privileges:

```csharp{title="AsSystem() - System Operations" description="Use AsSystem() when dispatching messages from system contexts where no user identity exists, or when a user-initiated" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "AsSystem", "System"]}
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

### RunAs() - Impersonation {#run-as}

Use `RunAs()` when a user needs to perform actions as another identity, with full audit trail:

```csharp{title="RunAs() - Impersonation" description="Use RunAs() when a user needs to perform actions as another identity, with full audit trail:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "RunAs", "Impersonation"]}
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

```csharp{title="Supported Methods" description="The security builder supports all dispatch methods:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Supported", "Methods"]}
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

```csharp{title="SecurityContextType Enum" description="Demonstrates securityContextType Enum" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "SecurityContextType", "Enum"]}
public enum SecurityContextType {
  User,           // Normal user context from HTTP/message
  System,         // System-initiated (no user involved)
  Impersonated,   // User running as different identity
  ServiceAccount  // Service-to-service with service identity
}
```

### Context Propagation

The explicit security context is propagated to outgoing message hops when `ImmutableScopeContext.ShouldPropagate` is `true` (the default for explicit contexts). This ensures downstream services receive the security context:

```csharp{title="Context Propagation" description="The explicit security context is propagated to outgoing message hops when `ImmutableScopeContext." category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Context", "Propagation"]}
// This message will carry SYSTEM context to downstream services
await dispatcher.AsSystem().SendAsync(new MaintenanceCommand());
```

### Design Principles

1. **No implicit fallback to elevated** - Code must explicitly request system or elevated context
2. **Full audit trail** - Both actual and effective identities are always captured
3. **Context restoration** - Previous context is restored after dispatch completes (try/finally)
4. **Authorization not bypassed** - This only sets context, not permissions

## Integration with Existing Security {#integration}

This message security system complements existing security tools:

| Existing Tool | Relationship |
|--------------|--------------|
| **IScopeContext/Accessor** | Provider populates this - single source of truth |
| **WhizbangScopeMiddleware** | HTTP equivalent; this is the message equivalent |
| **MessageHop.SecurityContext** | Default extractor reads from this |
| **PerspectiveScope** | Included in IScopeContext.Scope |
| **Scoped Lens Factory** | Reads from IScopeContextAccessor (works automatically) |
| **System Events** | Provider emits `ScopeContextEstablished` for audit |

## AOT Compatibility {#aot}

The message security system is fully AOT-compatible:

- No reflection for extractor/callback discovery
- Explicit generic registration: `AddSecurityExtractor<T>()`
- `[DynamicallyAccessedMembers]` attributes on generic constraints
- All type resolution at compile time

## Related Documentation

- [Security System](./security.md) - Permissions, roles, and scope context
- [Scoping](./scoping.md) - PerspectiveScope and multi-tenancy
- [System Events](../events/system-events.md) - Audit events
- [Transport Consumer](../../messaging/transports/transport-consumer.md) - Message processing workers
