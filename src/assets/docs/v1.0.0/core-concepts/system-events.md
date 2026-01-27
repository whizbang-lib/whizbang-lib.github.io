# System Events

Whizbang emits system events for auditing, monitoring, and observability. Events are written to the dedicated `$wb-system` stream, isolated from domain events.

## Overview

System events enable:

- **Audit trails** - Who accessed what, when, and with what permissions
- **Security monitoring** - Track access denials and suspicious activity
- **Performance observability** - Measure processing times and throughput
- **Compliance** - Meet regulatory requirements for access logging

## Security Events

### AccessDenied

Emitted when access to a resource is denied due to insufficient permissions.

```csharp
public sealed record AccessDenied : ISystemEvent {
  // What was being accessed
  public required string ResourceType { get; init; }
  public string? ResourceId { get; init; }

  // What was required
  public required Permission RequiredPermission { get; init; }

  // What the caller had
  public required IReadOnlySet<Permission> CallerPermissions { get; init; }
  public required IReadOnlySet<string> CallerRoles { get; init; }

  // Context
  public required PerspectiveScope Scope { get; init; }
  public required AccessDenialReason Reason { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
}

public enum AccessDenialReason {
  InsufficientPermission,
  InsufficientRole,
  ScopeViolation,
  PolicyRejected
}
```

**Example**:
```json
{
  "resourceType": "IOrderLens",
  "resourceId": null,
  "requiredPermission": "orders:delete",
  "callerPermissions": ["orders:read", "orders:write"],
  "callerRoles": ["User"],
  "scope": {
    "tenantId": "tenant-123",
    "userId": "user-456"
  },
  "reason": "InsufficientPermission",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### AccessGranted

Emitted when access to a sensitive resource is granted. Useful for audit trails of privileged access.

```csharp
public sealed record AccessGranted : ISystemEvent {
  public required string ResourceType { get; init; }
  public string? ResourceId { get; init; }
  public required Permission UsedPermission { get; init; }
  public required ScopeFilter AccessFilter { get; init; }
  public required PerspectiveScope Scope { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
}
```

### PermissionChanged

Emitted when a user's permissions or roles are modified.

```csharp
public sealed record PermissionChanged : ISystemEvent {
  public required string UserId { get; init; }
  public required string TenantId { get; init; }
  public required PermissionChangeType ChangeType { get; init; }

  // What changed
  public IReadOnlySet<string>? RolesAdded { get; init; }
  public IReadOnlySet<string>? RolesRemoved { get; init; }
  public IReadOnlySet<Permission>? PermissionsAdded { get; init; }
  public IReadOnlySet<Permission>? PermissionsRemoved { get; init; }

  // Who made the change
  public required string ChangedBy { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
}

public enum PermissionChangeType {
  RolesAdded,
  RolesRemoved,
  PermissionsAdded,
  PermissionsRemoved,
  FullReassignment
}
```

### ScopeContextEstablished

Emitted when a scope context is established for a request/operation.

```csharp
public sealed record ScopeContextEstablished : ISystemEvent {
  public required PerspectiveScope Scope { get; init; }
  public required IReadOnlySet<string> Roles { get; init; }
  public required IReadOnlySet<Permission> Permissions { get; init; }
  public required string Source { get; init; }  // "JWT", "ApiKey", etc.
  public required DateTimeOffset Timestamp { get; init; }
}
```

## Audit Events

### EventAudited

Emitted when a domain event is appended to a stream.

```csharp
public sealed record EventAudited : ISystemEvent {
  public required Guid StreamId { get; init; }
  public required long StreamPosition { get; init; }
  public required string EventType { get; init; }
  public required string EventId { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
  public PerspectiveScope? Scope { get; init; }
}
```

### CommandAudited

Emitted when a command is processed by a receptor.

```csharp
public sealed record CommandAudited : ISystemEvent {
  public required string CommandType { get; init; }
  public required string ReceptorName { get; init; }
  public required bool Succeeded { get; init; }
  public string? ErrorMessage { get; init; }
  public required TimeSpan Duration { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
  public PerspectiveScope? Scope { get; init; }
}
```

## Emitting Events

Use `ISystemEventEmitter` to emit system events.

```csharp
public interface ISystemEventEmitter {
  Task EmitEventAuditedAsync<TEvent>(
    Guid streamId,
    long streamPosition,
    MessageEnvelope<TEvent> envelope,
    CancellationToken cancellationToken = default);

  Task EmitCommandAuditedAsync<TCommand, TResponse>(
    TCommand command,
    TResponse response,
    string receptorName,
    IMessageContext? context,
    CancellationToken cancellationToken = default) where TCommand : notnull;

  Task EmitAsync<TSystemEvent>(
    TSystemEvent systemEvent,
    CancellationToken cancellationToken = default) where TSystemEvent : ISystemEvent;

  bool ShouldExcludeFromAudit(Type type);
}
```

### Example Usage

```csharp
public class OrderService {
  private readonly ISystemEventEmitter _emitter;

  public async Task GrantAccess(string userId, Permission permission) {
    // ... grant access logic ...

    await _emitter.EmitAsync(new PermissionChanged {
      UserId = userId,
      TenantId = currentTenant,
      ChangeType = PermissionChangeType.PermissionsAdded,
      PermissionsAdded = new HashSet<Permission> { permission },
      ChangedBy = currentUser,
      Timestamp = DateTimeOffset.UtcNow
    });
  }
}
```

## Excluding Events from Audit

Mark events with `[AuditEvent(Exclude = true)]` to prevent re-auditing:

```csharp
[AuditEvent(Exclude = true)]
public record InternalHealthCheckEvent : IEvent {
  // Won't be audited (prevents infinite loops)
}
```

The emitter checks `ShouldExcludeFromAudit()` before emitting.

## Configuration

### Registering the Emitter

```csharp
builder.Services.AddSingleton<ISystemEventEmitter, SystemEventEmitter>();
```

### Configuring Event Options

```csharp
builder.Services.AddSingleton(new SystemEventOptions {
  // System event stream name
  StreamName = "$wb-system",

  // Enable/disable specific event types
  EmitAccessGranted = true,  // Default: false (noisy)
  EmitScopeContextEstablished = false,  // Default: false

  // Filtering
  ExcludedEventTypes = new[] { typeof(HealthCheckEvent) }
});
```

## Subscribing to System Events

Process system events for alerting, dashboards, or external systems.

```csharp
public class SecurityAlertHandler {
  public async Task HandleAccessDenied(AccessDenied @event) {
    if (@event.Reason == AccessDenialReason.PolicyRejected) {
      // Alert on policy violations
      await _alertService.SendSecurityAlert(
        $"Policy rejection for {event.ResourceType}",
        @event);
    }
  }
}
```

## Related Documentation

- [Security](./security.md) - Permissions and access control
- [Scoping](./scoping.md) - Multi-tenancy and data isolation
