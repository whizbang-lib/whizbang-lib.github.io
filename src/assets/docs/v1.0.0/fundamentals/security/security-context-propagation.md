---
title: Security Context Propagation
version: 1.0.0
category: Core Concepts
order: 7
description: >-
  End-to-end security context flow across service boundaries, from HTTP requests through message processing, with automatic propagation and audit trails.
tags: 'security, message-security, scoping, distributed-systems, audit, context-propagation'
---

# Security Context Propagation

Security context propagation ensures that security identity (TenantId, UserId, roles, permissions) flows seamlessly across service boundaries in distributed systems. Whizbang provides automatic propagation from HTTP requests through message processing without manual intervention.

## Overview

In distributed systems, security context must flow across multiple hops:

1. **HTTP Request** → API receives authenticated user request
2. **Message Dispatch** → API sends command/event to message bus
3. **Message Transport** → Azure Service Bus, RabbitMQ, etc.
4. **Message Receipt** → Consumer service receives message
5. **Business Logic** → Handler executes with original security context

**Without propagation**, each service must manually extract and forward security information. **With Whizbang**, security context flows automatically.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         HTTP Request                            │
│                    (Bearer Token / Cookie)                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   WhizbangScopeMiddleware (HTTP)      │
        │   • Extracts JWT claims               │
        │   • Populates IScopeContextAccessor   │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   Business Logic / Controller         │
        │   • Calls dispatcher.SendAsync()      │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   Dispatcher (Outgoing Messages)      │
        │   • Reads IScopeContextAccessor       │
        │   • Attaches to MessageHop            │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   Transport (Azure Service Bus, etc.) │
        │   • Carries MessageHop.SecurityContext│
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   ServiceBusConsumerWorker (Incoming) │
        │   • Creates DI scope                  │
        │   • Calls provider.EstablishContextAsync()│
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   MessageHopSecurityExtractor         │
        │   • Reads MessageHop.SecurityContext  │
        │   • Populates IScopeContextAccessor   │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   ISecurityContextCallback[]          │
        │   • Initialize custom services        │
        │   • Populate UserContextManager       │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   Receptor / Business Logic           │
        │   • Executes with full security ctx   │
        └───────────────────────────────────────┘
```

## HTTP to Message Propagation

### Step 1: HTTP Request Establishes Context

The `WhizbangScopeMiddleware` extracts security context from HTTP requests:

```csharp{title="Step 1: HTTP Request Establishes Context" description="The WhizbangScopeMiddleware extracts security context from HTTP requests:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "HTTP"]}
// Startup.cs
app.UseWhizbangScopeMiddleware(options => {
  options.ExtractFromJwt = true;
  options.JwtClaimMappings = new Dictionary<string, string> {
    ["tenant_id"] = "TenantId",
    ["sub"] = "UserId",
    ["org_id"] = "OrganizationId"
  };
  options.ExtractRolesFromClaim = "roles";
  options.ExtractPermissionsFromClaim = "permissions";
});
```

This middleware:
- Extracts claims from JWT bearer tokens
- Maps claims to `IScopeContext` properties
- Populates `IScopeContextAccessor.Current`
- Makes context available to downstream code

### Step 2: Dispatcher Reads Ambient Context

When business logic dispatches a message, the dispatcher automatically reads the ambient security context:

```csharp{title="Step 2: Dispatcher Reads Ambient Context" description="When business logic dispatches a message, the dispatcher automatically reads the ambient security context:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Dispatcher"]}
// In your controller or service
public class OrderController : ControllerBase {
  private readonly IDispatcher _dispatcher;

  [HttpPost]
  public async Task<IActionResult> CreateOrder(CreateOrderRequest request) {
    // Dispatcher reads IScopeContextAccessor.Current automatically
    await _dispatcher.SendAsync(new CreateOrder {
      CustomerId = request.CustomerId,
      Items = request.Items
    });

    return Ok();
  }
}
```

No manual context passing required - the dispatcher finds it via `IScopeContextAccessor`.

### Step 3: Security Context Attached to MessageHop

The dispatcher attaches security context to the message's hop:

```csharp{title="Step 3: Security Context Attached to MessageHop" description="The dispatcher attaches security context to the message's hop:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Context"]}
// Inside Dispatcher.SendAsync()
var scopeContext = _scopeContextAccessor.Current;

if (scopeContext is ImmutableScopeContext immutable && immutable.ShouldPropagate) {
  var hop = new MessageHop {
    Type = HopType.Current,
    ServiceInstance = _serviceInstance,
    SecurityContext = new SecurityContext {
      TenantId = scopeContext.Scope.TenantId,
      UserId = scopeContext.Scope.UserId,
      OrganizationId = scopeContext.Scope.OrganizationId,
      CustomerId = scopeContext.Scope.CustomerId
    }
  };

  envelope.Hops.Add(hop);
}
```

**Key Point**: `ImmutableScopeContext.ShouldPropagate` controls whether security flows to downstream services.

### Step 4: Message Serialized with SecurityContext

The message envelope, including hop chain with security context, is serialized and sent to the transport:

```json{title="Step 4: Message Serialized with SecurityContext" description="The message envelope, including hop chain with security context, is serialized and sent to the transport:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Message"]}
{
  "messageId": "123e4567-e89b-12d3-a456-426614174000",
  "messageType": "MyApp.Orders.CreateOrder",
  "payload": { "customerId": "cust-456", "items": [...] },
  "hops": [
    {
      "type": "Current",
      "serviceInstance": "OrderApi-prod-1",
      "timestamp": "2026-03-03T10:00:00Z",
      "securityContext": {
        "tenantId": "tenant-123",
        "userId": "user-789",
        "organizationId": "org-456"
      }
    }
  ]
}
```

## Message to Handler Propagation

### Step 5: Consumer Receives Message

The `ServiceBusConsumerWorker` receives the message from the transport and deserializes the envelope:

```csharp{title="Step 5: Consumer Receives Message" description="The ServiceBusConsumerWorker receives the message from the transport and deserializes the envelope:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Consumer"]}
// Inside ServiceBusConsumerWorker
var envelope = await DeserializeEnvelopeAsync(serviceBusMessage);

// Create DI scope for this message
await using var scope = _serviceProvider.CreateAsyncScope();

// Establish security context BEFORE executing handlers
await _securityContextProvider.EstablishContextAsync(
  envelope,
  scope.ServiceProvider,
  cancellationToken);

// Now dispatch to receptors
await _dispatcher.LocalInvokeAsync(envelope.Payload, cancellationToken);
```

### Step 6: Security Context Extracted from Hops

The `MessageHopSecurityExtractor` reads the security context from the hop chain:

```csharp{title="Step 6: Security Context Extracted from Hops" description="The MessageHopSecurityExtractor reads the security context from the hop chain:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Context"]}
public class MessageHopSecurityExtractor : ISecurityContextExtractor {
  public int Priority => 100; // Runs first

  public ValueTask<SecurityExtraction?> ExtractAsync(
    IMessageEnvelope envelope,
    MessageSecurityOptions options,
    CancellationToken cancellationToken = default) {

    // Find most recent hop with security context
    var hop = envelope.Hops
      .Where(h => h.SecurityContext is not null)
      .OrderByDescending(h => h.Timestamp)
      .FirstOrDefault();

    if (hop?.SecurityContext is null) {
      return ValueTask.FromResult<SecurityExtraction?>(null);
    }

    // Extract security information
    return ValueTask.FromResult<SecurityExtraction?>(new SecurityExtraction {
      Scope = new PerspectiveScope {
        TenantId = hop.SecurityContext.TenantId,
        UserId = hop.SecurityContext.UserId,
        OrganizationId = hop.SecurityContext.OrganizationId,
        CustomerId = hop.SecurityContext.CustomerId
      },
      Roles = new HashSet<string>(),
      Permissions = new HashSet<Permission>(),
      SecurityPrincipals = new HashSet<SecurityPrincipalId>(),
      Claims = new Dictionary<string, string>(),
      Source = "MessageHop"
    });
  }
}
```

### Step 7: Context Populated and Callbacks Invoked

The `DefaultMessageSecurityContextProvider` establishes the context:

```csharp{title="Step 7: Context Populated and Callbacks Invoked" description="The DefaultMessageSecurityContextProvider establishes the context:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Context"]}
// 1. Extract security (via MessageHopSecurityExtractor)
var extraction = await extractor.ExtractAsync(envelope, options, ct);

// 2. Wrap in ImmutableScopeContext
var context = new ImmutableScopeContext(extraction, shouldPropagate: true);

// 3. Set accessor for this scope
scopeAccessor.Current = context;

// 4. Invoke all callbacks
foreach (var callback in callbacks) {
  await callback.OnContextEstablishedAsync(context, envelope, scopedProvider, ct);
}

// 5. Emit audit event (if enabled)
if (options.EnableAuditLogging) {
  await emitter.EmitAsync(new ScopeContextEstablished {
    Scope = context.Scope,
    Roles = context.Roles,
    Permissions = context.Permissions,
    Source = "MessageHop",
    Timestamp = DateTimeOffset.UtcNow
  });
}
```

### Step 8: Handler Executes with Context

The receptor now has full access to the original security context:

```csharp{title="Step 8: Handler Executes with Context" description="The receptor now has full access to the original security context:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Handler"]}
public class CreateOrderReceptor : IReceptor<CreateOrder> {
  private readonly IScopeContextAccessor _scopeAccessor;
  private readonly IScopedLensFactory _lensFactory;

  public async Task ReceiveAsync(CreateOrder message, CancellationToken ct) {
    var context = _scopeAccessor.Current!;

    // Same TenantId and UserId from original HTTP request
    Console.WriteLine($"Tenant: {context.Scope.TenantId}");
    Console.WriteLine($"User: {context.Scope.UserId}");

    // Scoped queries use the propagated context
    var orderLens = _lensFactory.GetUserLens<IOrderLens>();
    await orderLens.InsertAsync(new Order {
      CustomerId = message.CustomerId,
      Items = message.Items
    });
  }
}
```

## Controlling Propagation

### Enable/Disable Globally

```csharp{title="Enable/Disable Globally" description="Demonstrates enable/Disable Globally" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Enable", "Disable"]}
services.AddWhizbangMessageSecurity(options => {
  // Enable/disable propagation globally
  options.PropagateToOutgoingMessages = true; // default
});
```

### Per-Context Control

```csharp{title="Per-Context Control" description="Demonstrates per-Context Control" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Per-Context", "Control"]}
// Create context with propagation enabled
var extraction = new SecurityExtraction { /* ... */ };
var propagate = new ImmutableScopeContext(extraction, shouldPropagate: true);

// Create context that stays local (no propagation)
var local = new ImmutableScopeContext(extraction, shouldPropagate: false);
```

### Explicit Context Override

For system operations or impersonation, use explicit context:

```csharp{title="Explicit Context Override" description="For system operations or impersonation, use explicit context:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Explicit", "Context"]}
// System context (no user)
await dispatcher.AsSystem().SendAsync(new MaintenanceCommand());
// SecurityContext on hop: { ContextType = System, EffectivePrincipal = "SYSTEM" }

// Impersonation context
await dispatcher.RunAs("target-user@example.com").SendAsync(command);
// SecurityContext on hop: { ContextType = Impersonated, ActualPrincipal = "admin@...", EffectivePrincipal = "target-user@..." }
```

## Multi-Hop Propagation

Security context flows across multiple service hops:

```
HTTP → Service A → Service B → Service C

User makes request
    ↓ (JWT)
Service A (API)
    ↓ MessageHop.SecurityContext = { TenantId, UserId }
Service B (Worker)
    ↓ MessageHop.SecurityContext = { TenantId, UserId }
Service C (Processor)
    ↓ All services see same TenantId, UserId
```

Each service adds a new hop to the chain, preserving the security context:

```json{title="Multi-Hop Propagation" description="Each service adds a new hop to the chain, preserving the security context:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Multi-Hop", "Propagation"]}
{
  "hops": [
    {
      "type": "Current",
      "serviceInstance": "ServiceA-1",
      "securityContext": { "tenantId": "t1", "userId": "u1" }
    },
    {
      "type": "Previous",
      "serviceInstance": "ServiceA-1"
    },
    {
      "type": "Current",
      "serviceInstance": "ServiceB-2",
      "securityContext": { "tenantId": "t1", "userId": "u1" }
    }
  ]
}
```

## Audit Trail

Every security context establishment is audited (when `EnableAuditLogging = true`):

```csharp{title="Audit Trail" description="Every security context establishment is audited (when EnableAuditLogging = true):" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Audit", "Trail"]}
public sealed record ScopeContextEstablished : ISystemEvent {
  public required PerspectiveScope Scope { get; init; }
  public required IReadOnlySet<string> Roles { get; init; }
  public required IReadOnlySet<Permission> Permissions { get; init; }
  public required string Source { get; init; }  // "MessageHop", "JwtPayload", etc.
  public required DateTimeOffset Timestamp { get; init; }
}
```

This enables:
- **Security audits**: Who accessed what, when
- **Compliance**: GDPR, HIPAA, SOC 2 audit trails
- **Debugging**: Trace security context flow across services
- **Monitoring**: Detect unauthorized access attempts

## Security Considerations

### 1. Trust Boundaries

**Problem**: Services within the trust boundary should accept `MessageHop.SecurityContext` from other services, but messages from external sources should not.

**Solution**: Use different extractors for internal vs external messages:

```csharp{title="Trust Boundaries" description="Solution: Use different extractors for internal vs external messages:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Trust", "Boundaries"]}
// Internal service-to-service: Trust MessageHop
services.AddSecurityExtractor<MessageHopSecurityExtractor>(); // Priority 100

// External API: Require JWT in payload
services.AddSecurityExtractor<JwtPayloadExtractor>(); // Priority 50 (runs first)
```

### 2. Token Expiration

**Problem**: Long-running message processing may outlive the original JWT token.

**Solution**: Extract security at message ingress, not at processing time. The `MessageHop.SecurityContext` is a snapshot, not a live token.

### 3. Privilege Escalation

**Problem**: Malicious service could forge `MessageHop.SecurityContext` to impersonate users.

**Solution**:
- Use message signing/encryption for cross-service communication
- Validate message signatures before trusting security context
- Use `AsSystem()` or `RunAs()` with explicit audit trails for elevated operations

### 4. Cross-Tenant Isolation

**Problem**: Bug in one service could leak data across tenants.

**Solution**:
- Always use `IScopedLensFactory` for queries (automatic tenant filtering)
- Enable audit logging to detect cross-tenant access attempts
- Use database-level row-level security (RLS) as defense-in-depth

## Integration with UserContextManager

For legacy systems with existing `UserContextManager`, use a callback to bridge:

```csharp{title="Integration with UserContextManager" description="For legacy systems with existing UserContextManager, use a callback to bridge:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Integration", "UserContextManager"]}
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

// Register callback
services.AddSecurityContextCallback<UserContextManagerCallback>();
```

This ensures `UserContextManager` is populated **before** any receptor code runs.

## Best Practices

### DO

- **Enable audit logging** for compliance and debugging
- **Use IScopedLensFactory** for all queries to ensure tenant isolation
- **Trust MessageHop security context** within your service boundary
- **Use callbacks** to initialize custom services with security context
- **Test cross-service flows** to verify security propagation

### DON'T

- **Don't bypass scoped lenses** with raw SQL or global queries
- **Don't trust security context from external/untrusted sources** without validation
- **Don't cache security context** across requests (it's request-scoped)
- **Don't disable propagation** unless you have a strong reason
- **Don't forget to test** security isolation in multi-tenant scenarios

## Related Documentation

- [Message Security](./message-security.md) - Security context establishment for messages
- [Security](./security.md) - Permissions, roles, and access control
- [Scoping](./scoping.md) - Multi-tenancy and data isolation
- [Scoped Lenses](./scoped-lenses.md) - Automatic scope-based filtering
- [System Events](./system-events.md) - Audit events and monitoring

---

*Version 1.0.0 - Foundation Release*
