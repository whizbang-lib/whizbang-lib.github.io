---
title: System Events
version: 1.0.0
category: Core Concepts
order: 8
description: >-
  Internal events emitted by Whizbang for observability, auditing, and
  diagnostics - isolated from domain events in dedicated system stream
tags: 'system-events, audit, monitoring, observability, diagnostics, security, compliance'
codeReferences:
  - src/Whizbang.Core/SystemEvents/ISystemEvent.cs
  - src/Whizbang.Core/SystemEvents/SystemEventEmitter.cs
  - src/Whizbang.Core/SystemEvents/ISystemEventEmitter.cs
  - src/Whizbang.Core/SystemEvents/SystemEventOptions.cs
  - src/Whizbang.Core/SystemEvents/SystemEventTransportFilter.cs
  - src/Whizbang.Core/SystemEvents/SystemEventStream.cs
  - src/Whizbang.Core/SystemEvents/EventAudited.cs
  - src/Whizbang.Core/SystemEvents/CommandAudited.cs
  - src/Whizbang.Core/SystemEvents/CommandAuditPipelineBehavior.cs
  - src/Whizbang.Core/SystemEvents/AuditingEventStoreDecorator.cs
  - src/Whizbang.Core/SystemEvents/Security/ScopeContextEstablished.cs
  - src/Whizbang.Core/SystemEvents/Security/PermissionChanged.cs
  - src/Whizbang.Core/SystemEvents/Security/AccessGranted.cs
  - src/Whizbang.Core/SystemEvents/Security/AccessDenied.cs
  - tests/Whizbang.Core.Tests/SystemEvents/SystemEventEmitterTests.cs
  - src/Whizbang.Core/Events/System/SystemEvents.cs
  - tests/Whizbang.Core.Tests/SystemEvents/SystemEventTransportFilterTests.cs
---

# System Events

System events are **internal events emitted by Whizbang** for observability, auditing, and diagnostics. Unlike domain events which represent business facts, system events capture infrastructure operations, security decisions, and audit trails.

## Core Concept

```
┌─────────────────────────────────────────────────────────────────┐
│  Domain Infrastructure (Events, Commands, Perspectives)          │
│       │                                                          │
│       ▼                                                          │
│  System Event Emitter                                           │
│       │                                                          │
│       ├─► EventAudited (domain event stored)                    │
│       ├─► CommandAudited (command processed)                    │
│       ├─► ScopeContextEstablished (security context set)        │
│       ├─► AccessGranted/AccessDenied (authorization)            │
│       └─► PermissionChanged (role/permission changes)           │
│                                                                  │
│  ↓ Stored in dedicated $wb-system stream                        │
│  ↓ Consumed by perspectives (same as domain events)             │
│  ↓ LocalOnly by default (no network traffic)                    │
└─────────────────────────────────────────────────────────────────┘
```

**Key principles**:
- **Isolated stream**: System events stored in `$wb-system` stream (separate from domain events)
- **Opt-in per host**: Enable only the system events you need per service
- **Same infrastructure**: System events use events, perspectives, and lenses
- **LocalOnly by default**: No transport publishing to avoid duplicate auditing
- **Self-audit prevention**: System events marked with `[AuditEvent(Exclude = true)]`

---

## Quick Start

### Enable System Events

```csharp{title="Enable System Events" description="Demonstrates enable System Events" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Enable", "System"]}
// In Program.cs - enable the system events you need
services.AddWhizbang(options => {
  // Enable event and command auditing
  options.SystemEvents.EnableAudit();

  // Or enable specific categories
  options.SystemEvents.EnableEventAudit();
  options.SystemEvents.EnableCommandAudit();
  options.SystemEvents.EnablePerspectiveEvents();
  options.SystemEvents.EnableErrorEvents();

  // Or enable everything
  options.SystemEvents.EnableAll();

  // LocalOnly is true by default - system events stay local
  // For centralized monitoring, use Broadcast()
  // options.SystemEvents.Broadcast();
});
```

### Consume System Events

System events are consumed like domain events - create perspectives:

```csharp{title="Consume System Events" description="System events are consumed like domain events - create perspectives:" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Events", "Consume", "System"]}
using Whizbang.Core.Perspectives;
using Whizbang.Core.SystemEvents;
using Whizbang.Core.Audit;

/// <summary>
/// Perspective that captures EventAudited system events.
/// </summary>
public sealed class AuditPerspective : IPerspectiveFor<AuditLogEntry, EventAudited> {
  public AuditLogEntry Apply(AuditLogEntry current, EventAudited @event) {
    return new AuditLogEntry {
      Id = @event.Id,
      StreamId = @event.OriginalStreamId,
      StreamPosition = @event.OriginalStreamPosition,
      EventType = @event.OriginalEventType,
      Timestamp = @event.Timestamp,
      TenantId = @event.TenantId,
      UserId = @event.UserId,
      Body = @event.OriginalBody
    };
  }
}

/// <summary>
/// Perspective that captures security events.
/// </summary>
public sealed class SecurityAuditPerspective :
    IPerspectiveFor<SecurityAuditEntry, AccessDenied>,
    IPerspectiveFor<SecurityAuditEntry, AccessGranted> {

  public SecurityAuditEntry Apply(SecurityAuditEntry current, AccessDenied @event) {
    return new SecurityAuditEntry {
      Id = @event.Id,
      EventType = "AccessDenied",
      ResourceType = @event.ResourceType,
      ResourceId = @event.ResourceId,
      UserId = @event.Scope.UserId,
      TenantId = @event.Scope.TenantId,
      Timestamp = @event.Timestamp,
      Details = new {
        RequiredPermission = @event.RequiredPermission.ToString(),
        CallerPermissions = @event.CallerPermissions.Select(p => p.ToString()).ToList(),
        Reason = @event.Reason.ToString()
      }
    };
  }

  public SecurityAuditEntry Apply(SecurityAuditEntry current, AccessGranted @event) {
    return new SecurityAuditEntry {
      Id = @event.Id,
      EventType = "AccessGranted",
      ResourceType = @event.ResourceType,
      ResourceId = @event.ResourceId,
      UserId = @event.Scope.UserId,
      TenantId = @event.Scope.TenantId,
      Timestamp = @event.Timestamp,
      Details = new {
        UsedPermission = @event.UsedPermission.ToString(),
        AccessFilter = @event.AccessFilter.ToString()
      }
    };
  }
}
```

---

## Built-in System Events

<a id="audit"></a>
### EventAudited

Emitted when a domain event is appended to a stream (when `EnableEventAudit()` is configured).

```csharp{title="EventAudited" description="Emitted when a domain event is appended to a stream (when EnableEventAudit() is configured)." category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Events", "EventAudited"]}
public sealed record EventAudited : ISystemEvent {
  /// <summary>
  /// Unique identifier for this audit event.
  /// </summary>
  [StreamId]
  public required Guid Id { get; init; }

  /// <summary>
  /// Type name of the original domain event (e.g., "OrderCreated").
  /// </summary>
  public required string OriginalEventType { get; init; }

  /// <summary>
  /// Stream ID where the original event was appended.
  /// </summary>
  public required string OriginalStreamId { get; init; }

  /// <summary>
  /// Position within the stream where the original event was appended.
  /// </summary>
  public required long OriginalStreamPosition { get; init; }

  /// <summary>
  /// Full body of the original event as JSON.
  /// </summary>
  public required JsonElement OriginalBody { get; init; }

  /// <summary>
  /// When the original event was recorded.
  /// </summary>
  public required DateTimeOffset Timestamp { get; init; }

  /// <summary>
  /// Tenant identifier from event scope.
  /// </summary>
  public string? TenantId { get; init; }

  /// <summary>
  /// User identifier from event scope.
  /// </summary>
  public string? UserId { get; init; }

  /// <summary>
  /// Correlation ID for distributed tracing.
  /// </summary>
  public string? CorrelationId { get; init; }

  /// <summary>
  /// Generic scope dictionary containing all security context values.
  /// Enables flexible row-level security beyond TenantId/UserId.
  /// </summary>
  public IReadOnlyDictionary<string, string?>? Scope { get; init; }
}
```

**Use cases**:
- Compliance audit trails (GDPR, SOX, HIPAA)
- "Who changed what, when?" queries
- Event replay and debugging
- Multi-tenant data access auditing

**Excluding events from audit**:

```csharp{title="EventAudited - ServiceHeartbeat" description="Excluding events from audit:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "EventAudited"]}
// Exclude high-frequency or non-essential events from audit
[AuditEvent(Exclude = true, Reason = "High-frequency heartbeat event")]
public sealed record ServiceHeartbeat : IEvent {
  public required Guid ServiceId { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
}
```

### CommandAudited

Emitted when a command is processed by a receptor (when `EnableCommandAudit()` is configured).

```csharp{title="CommandAudited" description="Emitted when a command is processed by a receptor (when EnableCommandAudit() is configured)." category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Events", "CommandAudited"]}
public sealed record CommandAudited : ISystemEvent {
  /// <summary>
  /// Unique identifier for this audit entry.
  /// </summary>
  [StreamId]
  public required Guid Id { get; init; }

  /// <summary>
  /// Type name of the command (e.g., "CreateOrder").
  /// </summary>
  public required string CommandType { get; init; }

  /// <summary>
  /// JSON representation of the command body.
  /// </summary>
  public required JsonElement CommandBody { get; init; }

  /// <summary>
  /// When the command was processed.
  /// </summary>
  public required DateTimeOffset Timestamp { get; init; }

  /// <summary>
  /// Name of the receptor that handled the command.
  /// </summary>
  public string? ReceptorName { get; init; }

  /// <summary>
  /// Type of the response returned by the receptor.
  /// </summary>
  public string? ResponseType { get; init; }

  /// <summary>
  /// Tenant context from the command scope.
  /// </summary>
  public string? TenantId { get; init; }

  /// <summary>
  /// User ID from the command scope.
  /// </summary>
  public string? UserId { get; init; }

  /// <summary>
  /// Generic scope dictionary for flexible security context.
  /// </summary>
  public IReadOnlyDictionary<string, string?>? Scope { get; init; }
}
```

**Use cases**:
- Command execution auditing
- "Who executed what command?" queries
- API call tracking
- Performance and usage analytics

<a id="scope-context-established"></a>
### ScopeContextEstablished

Emitted when a scope context is established for a request/operation.

```csharp{title="ScopeContextEstablished" description="Emitted when a scope context is established for a request/operation." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "ScopeContextEstablished"]}
public sealed record ScopeContextEstablished : ISystemEvent {
  [StreamId]
  public Guid Id { get; init; }

  /// <summary>
  /// The established scope (TenantId, UserId, etc.).
  /// </summary>
  public required PerspectiveScope Scope { get; init; }

  /// <summary>
  /// Roles in the context.
  /// </summary>
  public required IReadOnlySet<string> Roles { get; init; }

  /// <summary>
  /// Permissions in the context.
  /// </summary>
  public required IReadOnlySet<Permission> Permissions { get; init; }

  /// <summary>
  /// Source of the context (JWT, API Key, etc.).
  /// </summary>
  public required string Source { get; init; }

  /// <summary>
  /// When the context was established.
  /// </summary>
  public required DateTimeOffset Timestamp { get; init; }
}
```

**Use cases**:
- Authentication audit trails
- User session tracking
- Security context debugging

<a id="permission-changed"></a>
### PermissionChanged

Emitted when a user's permissions or roles change.

```csharp{title="PermissionChanged" description="Emitted when a user's permissions or roles change." category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Events", "PermissionChanged"]}
public sealed record PermissionChanged : ISystemEvent {
  [StreamId]
  public Guid Id { get; init; }

  /// <summary>
  /// User whose permissions changed.
  /// </summary>
  public required string UserId { get; init; }

  /// <summary>
  /// Tenant context.
  /// </summary>
  public required string TenantId { get; init; }

  /// <summary>
  /// Type of change (RolesAdded, RolesRemoved, etc.).
  /// </summary>
  public required PermissionChangeType ChangeType { get; init; }

  /// <summary>
  /// Roles added (if any).
  /// </summary>
  public IReadOnlySet<string>? RolesAdded { get; init; }

  /// <summary>
  /// Roles removed (if any).
  /// </summary>
  public IReadOnlySet<string>? RolesRemoved { get; init; }

  /// <summary>
  /// Permissions added (if any).
  /// </summary>
  public IReadOnlySet<Permission>? PermissionsAdded { get; init; }

  /// <summary>
  /// Permissions removed (if any).
  /// </summary>
  public IReadOnlySet<Permission>? PermissionsRemoved { get; init; }

  /// <summary>
  /// Who made the change.
  /// </summary>
  public required string ChangedBy { get; init; }

  /// <summary>
  /// When the change occurred.
  /// </summary>
  public required DateTimeOffset Timestamp { get; init; }
}
```

**Use cases**:
- Role/permission change auditing
- Security compliance tracking
- Access control debugging

<a id="access-granted"></a>
### AccessGranted

Emitted when access to a sensitive resource is granted.

```csharp{title="AccessGranted" description="Emitted when access to a sensitive resource is granted." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "AccessGranted"]}
public sealed record AccessGranted : ISystemEvent {
  [StreamId]
  public Guid Id { get; init; }

  /// <summary>
  /// Type of resource access was granted to.
  /// </summary>
  public required string ResourceType { get; init; }

  /// <summary>
  /// Optional resource identifier.
  /// </summary>
  public string? ResourceId { get; init; }

  /// <summary>
  /// The permission that was used.
  /// </summary>
  public required Permission UsedPermission { get; init; }

  /// <summary>
  /// Access filter applied (e.g., tenant-scoped).
  /// </summary>
  public required ScopeFilter AccessFilter { get; init; }

  /// <summary>
  /// Scope context at time of access.
  /// </summary>
  public required PerspectiveScope Scope { get; init; }

  /// <summary>
  /// When access was granted.
  /// </summary>
  public required DateTimeOffset Timestamp { get; init; }
}
```

**Use cases**:
- Privileged access auditing
- Compliance reporting (who accessed what)
- Security monitoring

<a id="access-denied"></a>
### AccessDenied

Emitted when access to a resource is denied due to insufficient permissions.

```csharp{title="AccessDenied" description="Emitted when access to a resource is denied due to insufficient permissions." category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Events", "AccessDenied"]}
public sealed record AccessDenied : ISystemEvent {
  [StreamId]
  public Guid Id { get; init; }

  /// <summary>
  /// Type of resource access was denied to.
  /// </summary>
  public required string ResourceType { get; init; }

  /// <summary>
  /// Optional resource identifier.
  /// </summary>
  public string? ResourceId { get; init; }

  /// <summary>
  /// The permission that was required.
  /// </summary>
  public required Permission RequiredPermission { get; init; }

  /// <summary>
  /// Permissions the caller had.
  /// </summary>
  public required IReadOnlySet<Permission> CallerPermissions { get; init; }

  /// <summary>
  /// Roles the caller had.
  /// </summary>
  public required IReadOnlySet<string> CallerRoles { get; init; }

  /// <summary>
  /// Scope context at time of denial.
  /// </summary>
  public required PerspectiveScope Scope { get; init; }

  /// <summary>
  /// Reason for denial.
  /// </summary>
  public required AccessDenialReason Reason { get; init; }

  /// <summary>
  /// When access was denied.
  /// </summary>
  public required DateTimeOffset Timestamp { get; init; }
}
```

**Use cases**:
- Security threat detection
- Failed access attempt auditing
- Authorization debugging

---

<a id="emitter"></a>
## System Event Emitter

The `ISystemEventEmitter` is responsible for emitting system events to the dedicated `$wb-system` stream.

```csharp{title="System Event Emitter" description="The ISystemEventEmitter is responsible for emitting system events to the dedicated $wb-system stream." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "System", "Event"]}
public interface ISystemEventEmitter {
  /// <summary>
  /// Emits an EventAudited system event for a domain event.
  /// </summary>
  Task EmitEventAuditedAsync<TEvent>(
      Guid streamId,
      long streamPosition,
      MessageEnvelope<TEvent> envelope,
      CancellationToken cancellationToken = default);

  /// <summary>
  /// Emits a CommandAudited system event for a command.
  /// </summary>
  Task EmitCommandAuditedAsync<TCommand, TResponse>(
      TCommand command,
      TResponse response,
      string receptorName,
      IMessageContext? context,
      CancellationToken cancellationToken = default) where TCommand : notnull;

  /// <summary>
  /// Emits a generic system event to the system stream.
  /// </summary>
  Task EmitAsync<TSystemEvent>(
      TSystemEvent systemEvent,
      CancellationToken cancellationToken = default) where TSystemEvent : ISystemEvent;

  /// <summary>
  /// Checks if the given type should be excluded from auditing.
  /// </summary>
  bool ShouldExcludeFromAudit(Type type);
}
```

**Default implementation**: `SystemEventEmitter`

```csharp{title="System Event Emitter - SystemEventEmitter" description="Default implementation: SystemEventEmitter" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "System", "Event"]}
public sealed class SystemEventEmitter : ISystemEventEmitter {
  private readonly SystemEventOptions _options;
  private readonly IEventStore _systemEventStore;

  // Emits system events only when enabled via options
  // Respects [AuditEvent(Exclude = true)] to prevent infinite loops
  // Serializes payloads in AOT-compatible way
}
```

**Manual emission** (advanced scenarios):

```csharp{title="System Event Emitter - MySecurityService" description="Manual emission (advanced scenarios):" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "System", "Event"]}
public class MySecurityService {
  private readonly ISystemEventEmitter _emitter;

  public async Task GrantAccessAsync(string userId, string resourceId) {
    // ... grant access logic ...

    // Manually emit security system event
    await _emitter.EmitAsync(new AccessGranted {
      Id = TrackedGuid.NewMedo(),
      ResourceType = "SensitiveDocument",
      ResourceId = resourceId,
      UsedPermission = Permission.Read,
      AccessFilter = ScopeFilter.Tenant("tenant-123"),
      Scope = new PerspectiveScope {
        TenantId = "tenant-123",
        UserId = userId
      },
      Timestamp = DateTimeOffset.UtcNow
    });
  }
}
```

---

<a id="configuration"></a>
## System Event Configuration

System events are configured via `SystemEventOptions`:

```csharp{title="System Event Configuration" description="System events are configured via SystemEventOptions:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "System", "Event"]}
public sealed class SystemEventOptions {
  /// <summary>
  /// When true, system events stay local (no transport publishing).
  /// Default is true.
  /// </summary>
  public bool LocalOnly { get; set; } = true;

  /// <summary>
  /// Enables EventAudited system events.
  /// </summary>
  public bool EventAuditEnabled { get; private set; }

  /// <summary>
  /// Enables CommandAudited system events.
  /// </summary>
  public bool CommandAuditEnabled { get; private set; }

  /// <summary>
  /// Returns true if either event or command auditing is enabled.
  /// </summary>
  public bool AuditEnabled => EventAuditEnabled || CommandAuditEnabled;

  /// <summary>
  /// Enables perspective-related system events.
  /// </summary>
  public bool PerspectiveEventsEnabled { get; private set; }

  /// <summary>
  /// Enables error-related system events.
  /// </summary>
  public bool ErrorEventsEnabled { get; private set; }
}
```

**Configuration methods**:

```csharp{title="System Event Configuration (2)" description="Configuration methods:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "System", "Event"]}
// Enable all system events
options.SystemEvents.EnableAll();

// Enable audit (both events and commands)
options.SystemEvents.EnableAudit();

// Enable specific categories
options.SystemEvents.EnableEventAudit();
options.SystemEvents.EnableCommandAudit();
options.SystemEvents.EnablePerspectiveEvents();
options.SystemEvents.EnableErrorEvents();

// Broadcast system events to transport (advanced)
options.SystemEvents.Broadcast(); // Sets LocalOnly = false
```

**LocalOnly vs Broadcast**:

```csharp{title="System Event Configuration (3)" description="LocalOnly vs Broadcast:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "System", "Event"]}
// Default: LocalOnly = true
// Each service audits what it processes locally
// No network traffic, no duplication
services.AddWhizbang(options => {
  options.SystemEvents.EnableAudit();
  // LocalOnly is true by default
});

// Broadcast mode: LocalOnly = false
// System events published to transport
// Use when you have centralized monitoring service
services.AddWhizbang(options => {
  options.SystemEvents.EnableAll();
  options.SystemEvents.Broadcast(); // Sets LocalOnly = false
});
```

**Why LocalOnly by default?**

Consider this scenario:
- BFF receives events from Orders and Users services
- Both BFF and Users service have audit enabled

Without `LocalOnly`:
1. Users service audits `UserCreated` locally
2. Users service publishes `EventAudited` to transport
3. BFF receives `UserCreated` and audits it locally
4. BFF receives `EventAudited` from Users service (duplicate!)

With `LocalOnly = true`:
1. Users service audits `UserCreated` locally (stays local)
2. BFF receives `UserCreated` and audits it locally (stays local)
3. No duplicate audit events!

---

<a id="transport-filtering"></a>
## Transport Filtering

The `SystemEventTransportFilter` implements `ITransportPublishFilter` to control which events flow through the transport layer:

```csharp{title="Transport Filtering" description="The SystemEventTransportFilter implements ITransportPublishFilter to control which events flow through the transport" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Transport", "Filtering"]}
public sealed class SystemEventTransportFilter : ITransportPublishFilter {
  private readonly SystemEventOptions _options;

  public bool ShouldPublishToTransport(object message) {
    // Domain events always publish
    if (message is not ISystemEvent) {
      return true;
    }

    // System events respect LocalOnly setting
    return !_options.LocalOnly;
  }

  public bool ShouldReceiveFromTransport(Type messageType) {
    // Domain events always received
    if (!typeof(ISystemEvent).IsAssignableFrom(messageType)) {
      return true;
    }

    // System events respect LocalOnly setting
    return !_options.LocalOnly;
  }
}
```

**Routing rules**:
- **Domain events**: Always flow through transport (cross-service communication)
- **System events**: Respect `LocalOnly` setting (default: stay local)

This ensures:
- Domain events drive business workflows across services
- System events provide local observability without network overhead
- No duplicate auditing when multiple services enable audit

---

<a id="event-auditing"></a>
## Event Auditing Decorator

The `AuditingEventStoreDecorator` wraps your `IEventStore` implementation and automatically emits `EventAudited` system events:

```csharp{title="Event Auditing Decorator" description="The AuditingEventStoreDecorator wraps your IEventStore implementation and automatically emits EventAudited system" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Event", "Auditing"]}
public sealed class AuditingEventStoreDecorator : IEventStore {
  private readonly IEventStore _inner;
  private readonly ISystemEventEmitter _emitter;

  public async Task AppendAsync<TMessage>(
      Guid streamId,
      MessageEnvelope<TMessage> envelope,
      CancellationToken cancellationToken = default) {
    // First, append to the inner store
    await _inner.AppendAsync(streamId, envelope, cancellationToken);

    // Get the stream position after append
    var streamPosition = await _inner.GetLastSequenceAsync(streamId, cancellationToken);

    // Emit audit event (emitter handles enabled check and exclusions)
    await _emitter.EmitEventAuditedAsync(streamId, streamPosition, envelope, cancellationToken);
  }

  // ... other IEventStore methods delegate to _inner ...
}
```

**Registration** (automatic with `AddSystemEventAuditing`):

```csharp{title="Event Auditing Decorator (2)" description="Registration (automatic with AddSystemEventAuditing):" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Event", "Auditing"]}
services.AddSingleton<IEventStore, PostgresEventStore>();
services.AddSystemEvents(options => options.EnableEventAudit());
services.DecorateEventStoreWithAuditing();
```

Or use the combined method:

```csharp{title="Event Auditing Decorator (3)" description="Or use the combined method:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Event", "Auditing"]}
services
  .AddWhizbang()
  .WithEFCore<MyDbContext>()
  .WithDriver.Postgres;

// Add auditing AFTER storage is configured
services.AddSystemEventAuditing(options => {
  options.EnableEventAudit();
  options.EnableCommandAudit();
});
```

---

<a id="command-auditing"></a>
## Command Auditing Pipeline Behavior

The `CommandAuditPipelineBehavior<TCommand, TResponse>` automatically emits `CommandAudited` system events for commands processed by receptors:

```csharp{title="Command Auditing Pipeline Behavior" description="The CommandAuditPipelineBehavior<TCommand, TResponse> automatically emits CommandAudited system events for commands" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Events", "Command", "Auditing"]}
public sealed class CommandAuditPipelineBehavior<TCommand, TResponse> : PipelineBehavior<TCommand, TResponse>
    where TCommand : notnull {
  private readonly ISystemEventEmitter _emitter;
  private readonly SystemEventOptions _options;
  private readonly IMessageContext? _context;

  public override async Task<TResponse> HandleAsync(
      TCommand request,
      Func<Task<TResponse>> continuation,
      CancellationToken cancellationToken = default) {
    // Execute the next behavior or handler
    var response = await ExecuteNextAsync(continuation);

    // Check if command auditing is enabled
    if (!_options.CommandAuditEnabled) {
      return response;
    }

    // Check if this command type should be excluded from audit
    if (_emitter.ShouldExcludeFromAudit(typeof(TCommand))) {
      return response;
    }

    // Extract receptor name from context metadata
    var receptorName = _extractReceptorName();

    // Emit the audit event
    await _emitter.EmitCommandAuditedAsync(
        request,
        response,
        receptorName,
        _context,
        cancellationToken);

    return response;
  }
}
```

**Registration** (automatic with `AddSystemEventAuditing`):

```csharp{title="Command Auditing Pipeline Behavior (2)" description="Registration (automatic with AddSystemEventAuditing):" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Command", "Auditing"]}
services.AddSystemEventAuditing(options => {
  options.EnableCommandAudit();
});
```

The pipeline behavior is registered automatically:

```csharp{title="Command Auditing Pipeline Behavior (3)" description="The pipeline behavior is registered automatically:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Command", "Auditing"]}
services.TryAddSingleton(
    typeof(IPipelineBehavior<,>),
    typeof(CommandAuditPipelineBehavior<,>));
```

---

<a id="stream"></a>
## System Event Stream

System events are stored in a dedicated stream with a fixed identifier:

```csharp{title="System Event Stream" description="System events are stored in a dedicated stream with a fixed identifier:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "System", "Event"]}
public static class SystemEventStreams {
  /// <summary>
  /// The name of the dedicated system event stream.
  /// Uses $ prefix following EventStoreDB convention for system streams.
  /// </summary>
  public static string Name => "$wb-system";

  /// <summary>
  /// Stream prefix for system events.
  /// </summary>
  public static string Prefix => "$wb-";

  /// <summary>
  /// Well-known GUID for the system event stream.
  /// Fixed: 00000000-0000-0000-0000-000000000001
  /// </summary>
  public static Guid StreamId { get; } = new Guid("00000000-0000-0000-0000-000000000001");
}
```

**Why a dedicated stream?**
- **Isolation**: System events separate from domain events
- **Performance**: Query system events without scanning domain streams
- **Clarity**: Clear separation of concerns
- **Convention**: Follows EventStoreDB's `$` prefix for system streams

---

<a id="registration"></a>
## Registration and Setup

### Basic Registration

```csharp{title="Basic Registration" description="Demonstrates basic Registration" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Basic", "Registration"]}
services.AddSystemEvents(options => {
  options.EnableAudit();
});
```

This registers:
- `ISystemEventEmitter` for emitting system events
- `ITransportPublishFilter` for transport filtering

### Full Auditing Registration

```csharp{title="Full Auditing Registration" description="Demonstrates full Auditing Registration" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Full", "Auditing"]}
services.AddSystemEventAuditing(options => {
  options.EnableEventAudit();
  options.EnableCommandAudit();
});
```

This registers:
- All basic system event services
- `CommandAuditPipelineBehavior<,>` for command auditing
- Event store decorator (if you call `DecorateEventStoreWithAuditing()`)

### Complete Setup Example

```csharp{title="Complete Setup Example" description="Demonstrates complete Setup Example" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Complete", "Setup"]}
// In Program.cs
var builder = WebApplication.CreateBuilder(args);

// Configure storage
builder.Services
  .AddWhizbang()
  .WithEFCore<MyDbContext>()
  .WithDriver.Postgres;

// Add system event auditing AFTER storage is configured
builder.Services.AddSystemEventAuditing(options => {
  options.EnableAll(); // Enable all system events
  // LocalOnly = true by default (no transport publishing)
});

// Register perspectives that consume system events
builder.Services.AddPerspective<AuditPerspective>();
builder.Services.AddPerspective<SecurityAuditPerspective>();

var app = builder.Build();
app.Run();
```

---

## Best Practices

### 1. Enable Only What You Need

```csharp{title="Enable Only What You Need" description="Demonstrates enable Only What You Need" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Enable", "Only"]}
// BFF: Enable full audit for compliance
services.AddWhizbang(options => {
  options.SystemEvents.EnableAudit();
});

// Background worker: Maybe just errors
services.AddWhizbang(options => {
  options.SystemEvents.EnableErrorEvents();
});

// Read-only query service: No system events needed
services.AddWhizbang();
```

### 2. Use LocalOnly (Default)

```csharp{title="Use LocalOnly (Default)" description="Demonstrates use LocalOnly (Default)" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "LocalOnly", "Default"]}
// Default behavior - system events stay local
services.AddWhizbang(options => {
  options.SystemEvents.EnableAudit();
  // LocalOnly = true by default
});

// Each service maintains its own audit trail
// No network traffic for system events
// No duplicate auditing
```

### 3. Exclude High-Frequency Events

```csharp{title="Exclude High-Frequency Events" description="Demonstrates exclude High-Frequency Events" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Exclude", "High-Frequency"]}
// Exclude events that would create excessive audit volume
[AuditEvent(Exclude = true, Reason = "High-frequency telemetry event")]
public sealed record MetricCaptured : IEvent {
  public required string MetricName { get; init; }
  public required double Value { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
}
```

### 4. Prevent Self-Auditing Loops

System events are already marked with `[AuditEvent(Exclude = true)]` to prevent infinite loops:

```csharp{title="Prevent Self-Auditing Loops" description="System events are already marked with [AuditEvent(Exclude = true)] to prevent infinite loops:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Prevent", "Self-Auditing"]}
[AuditEvent(Exclude = true, Reason = "System event - prevents infinite self-auditing loop")]
public sealed record EventAudited : ISystemEvent {
  // ...
}
```

Never remove this attribute from system events!

### 5. Query System Events Like Domain Events

```csharp{title="Query System Events Like Domain Events" description="Demonstrates query System Events Like Domain Events" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Query", "System"]}
public interface ISecurityAuditLens : ILensQuery<SecurityAuditEntry> { }

public class SecurityService {
  private readonly ISecurityAuditLens _securityLens;

  public async Task<IReadOnlyList<SecurityAuditEntry>> GetFailedAccessAttemptsAsync(
      string userId,
      DateTimeOffset since,
      CancellationToken ct) {
    return await _securityLens.QueryAsync(q => q
        .Where(e => e.EventType == "AccessDenied" &&
                    e.UserId == userId &&
                    e.Timestamp >= since)
        .OrderByDescending(e => e.Timestamp), ct);
  }
}
```

---

## Common Patterns

### Centralized Monitoring Service

```csharp{title="Centralized Monitoring Service" description="Demonstrates centralized Monitoring Service" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Centralized", "Monitoring"]}
// Monitoring service receives system events from all hosts
services.AddWhizbang(options => {
  options.SystemEvents.EnableAll();
  options.SystemEvents.Broadcast(); // Receive from transport
});

// All other services use LocalOnly (default)
// They emit system events but don't broadcast them
```

### Selective Security Auditing

```csharp{title="Selective Security Auditing" description="Demonstrates selective Security Auditing" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Selective", "Security"]}
// Only audit high-sensitivity operations
public class DocumentService {
  private readonly ISystemEventEmitter _emitter;

  public async Task<Document> ViewDocumentAsync(Guid documentId, SecurityContext ctx) {
    var doc = await _repo.GetAsync(documentId);

    // Emit AccessGranted for high-sensitivity documents only
    if (doc.Sensitivity == Sensitivity.High) {
      await _emitter.EmitAsync(new AccessGranted {
        Id = TrackedGuid.NewMedo(),
        ResourceType = "Document",
        ResourceId = documentId.ToString(),
        UsedPermission = Permission.Read,
        AccessFilter = ScopeFilter.Tenant(ctx.TenantId),
        Scope = new PerspectiveScope {
          TenantId = ctx.TenantId,
          UserId = ctx.UserId
        },
        Timestamp = DateTimeOffset.UtcNow
      });
    }

    return doc;
  }
}
```

### Multi-Tenant Audit Queries

```csharp{title="Multi-Tenant Audit Queries" description="Demonstrates multi-Tenant Audit Queries" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Multi-Tenant", "Audit"]}
public class AuditService {
  private readonly IAuditLogLens _auditLens;

  // Tenant admin views their own audit trail
  public async Task<IReadOnlyList<AuditLogEntry>> GetTenantAuditTrailAsync(
      string tenantId,
      CancellationToken ct) {
    return await _auditLens.QueryAsync(q => q
        .Where(a => a.TenantId == tenantId)
        .OrderByDescending(a => a.Timestamp), ct);
  }

  // System admin views cross-tenant audit trail
  public async Task<IReadOnlyList<AuditLogEntry>> GetSystemAuditTrailAsync(
      DateTimeOffset since,
      CancellationToken ct) {
    return await _auditLens.QueryAsync(q => q
        .Where(a => a.Timestamp >= since)
        .OrderByDescending(a => a.Timestamp), ct);
  }
}
```

---

## Related Documentation

- **[Audit Logging](../security/audit-logging.md)** - Compliance-ready audit logging using system events
- **[Message Security](../security/message-security.md)** - Security context and permissions
- **[Perspectives](../perspectives/perspectives.md)** - Consuming system events with perspectives
- **[Event Store](event-store.md)** - Storage infrastructure for system events
- **[Event Streams](event-streams.md)** - Stream concepts and conventions

---

## Summary

System events provide **observability, auditing, and diagnostics** for Whizbang infrastructure:

- **Isolated in `$wb-system` stream** - separate from domain events
- **Opt-in per host** - enable only what you need per service
- **LocalOnly by default** - no transport publishing, no duplication
- **Same infrastructure** - consumed via perspectives and lenses
- **Self-audit prevention** - system events excluded from audit
- **Built-in events** - EventAudited, CommandAudited, security events, perspective rebuild/rewind events, migration events
- **Extensible** - emit custom system events for your scenarios

Use system events to build compliance-ready audit trails, security monitoring, and operational insights without polluting your domain model.

---

<a id="perspective-rebuild-events"></a>
## Perspective Rebuild Events

These events are emitted during perspective rebuild operations (enabled via `EnablePerspectiveEvents()`). They track the full lifecycle of a rebuild.

### PerspectiveRebuildStarted

Emitted when a perspective rebuild starts (any mode).

```csharp{title="PerspectiveRebuildStarted" description="Emitted when a perspective rebuild starts" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Perspective", "Rebuild"]}
public record PerspectiveRebuildStarted(
    [property: StreamId] Guid StreamId,
    string PerspectiveName,
    RebuildMode Mode,
    int TotalStreams,
    DateTimeOffset StartedAt
) : IEvent;
```

### PerspectiveRebuildProgress

Emitted periodically during a rebuild to report progress.

```csharp{title="PerspectiveRebuildProgress" description="Emitted periodically during a rebuild to report progress" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Perspective", "Rebuild"]}
public record PerspectiveRebuildProgress(
    [property: StreamId] Guid StreamId,
    string PerspectiveName,
    RebuildMode Mode,
    int ProcessedStreams,
    int TotalStreams,
    int EventsReplayed,
    DateTimeOffset StartedAt
) : IEvent;
```

### PerspectiveRebuildCompleted

Emitted when a perspective rebuild completes successfully.

```csharp{title="PerspectiveRebuildCompleted" description="Emitted when a perspective rebuild completes successfully" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Perspective", "Rebuild"]}
public record PerspectiveRebuildCompleted(
    [property: StreamId] Guid StreamId,
    string PerspectiveName,
    RebuildMode Mode,
    int StreamsProcessed,
    int EventsReplayed,
    TimeSpan Duration
) : IEvent;
```

### PerspectiveRebuildFailed

Emitted when a perspective rebuild fails.

```csharp{title="PerspectiveRebuildFailed" description="Emitted when a perspective rebuild fails" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Perspective", "Rebuild"]}
public record PerspectiveRebuildFailed(
    [property: StreamId] Guid StreamId,
    string PerspectiveName,
    RebuildMode Mode,
    string Error,
    int StreamsProcessedBeforeFailure,
    TimeSpan Duration
) : IEvent;
```

---

<a id="perspective-rewind-events"></a>
## Perspective Rewind Events

These events are emitted when a perspective rewinds due to a late-arriving event. Rewind replays events from the nearest snapshot to incorporate out-of-order events.

### PerspectiveRewindStarted

Emitted when a perspective rewind begins.

```csharp{title="PerspectiveRewindStarted" description="Emitted when a perspective rewind begins due to a late-arriving event" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Perspective", "Rewind"]}
public record PerspectiveRewindStarted(
    [property: StreamId] Guid StreamId,
    string PerspectiveName,
    Guid TriggeringEventId,
    Guid? ReplayFromSnapshotEventId,
    bool HasSnapshot,
    DateTimeOffset StartedAt
) : IEvent;
```

### PerspectiveRewindCompleted

Emitted when a perspective rewind completes successfully.

```csharp{title="PerspectiveRewindCompleted" description="Emitted when a perspective rewind completes successfully" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Perspective", "Rewind"]}
public record PerspectiveRewindCompleted(
    [property: StreamId] Guid StreamId,
    string PerspectiveName,
    Guid TriggeringEventId,
    Guid FinalEventId,
    int EventsReplayed,
    DateTimeOffset StartedAt,
    DateTimeOffset CompletedAt
) : IEvent;
```

---

<a id="migration-events"></a>
## Migration Events

These events track the lifecycle of database migrations. They are emitted during `AddWhizbang()` startup when migrations are applied.

### MigrationItemStarted

Emitted when an individual migration starts processing.

```csharp{title="MigrationItemStarted" description="Emitted when an individual migration starts processing" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Migration"]}
public record MigrationItemStarted(
    [property: StreamId] Guid StreamId,
    string MigrationKey,
    MigrationStrategy Strategy,
    string? OldHash,
    string NewHash
) : IEvent;
```

### MigrationItemCompleted

Emitted when an individual migration completes.

```csharp{title="MigrationItemCompleted" description="Emitted when an individual migration completes" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Migration"]}
public record MigrationItemCompleted(
    [property: StreamId] Guid StreamId,
    string MigrationKey,
    MigrationStatus Status,
    string StatusDescription,
    TimeSpan Duration
) : IEvent;
```

### MigrationItemFailed

Emitted when an individual migration fails.

```csharp{title="MigrationItemFailed" description="Emitted when an individual migration fails" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Migration"]}
public record MigrationItemFailed(
    [property: StreamId] Guid StreamId,
    string MigrationKey,
    MigrationStatus Status,
    MigrationFailureReason FailureReason,
    string Error,
    TimeSpan Duration
) : IEvent;
```

### MigrationBatchStarted

Emitted when the full migration batch starts (all infrastructure + perspectives).

```csharp{title="MigrationBatchStarted" description="Emitted when the full migration batch starts" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Migration"]}
public record MigrationBatchStarted(
    [property: StreamId] Guid StreamId,
    string LibraryVersion,
    int TotalMigrations,
    int TotalPerspectives
) : IEvent;
```

### MigrationBatchCompleted

Emitted when the full migration batch completes, including per-item results.

```csharp{title="MigrationBatchCompleted" description="Emitted when the full migration batch completes" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Migration"]}
public record MigrationBatchCompleted(
    [property: StreamId] Guid StreamId,
    string LibraryVersion,
    MigrationBatchItemResult[] Results,
    int Applied,
    int Updated,
    int Skipped,
    int Failed,
    TimeSpan TotalDuration
) : IEvent;

public record MigrationBatchItemResult(
    string MigrationKey,
    MigrationStatus Status,
    string StatusDescription);
```

### Migration Enums {#migration-enums}

#### MigrationStatus

Status of a migration item in `wh_schema_migrations`:

| Value | Description |
|-------|-------------|
| `Applied` (1) | Migration was applied for the first time |
| `Updated` (2) | Migration was updated (hash changed) |
| `Skipped` (3) | Migration was skipped (hash unchanged) |
| `MigratingInBackground` (4) | Migration is running in the background |
| `Failed` (-1) | Migration failed |

#### MigrationStrategy

Strategy used for executing a migration:

| Value | Description |
|-------|-------------|
| `DirectDdl` | Direct DDL execution (CREATE TABLE, ALTER, etc.) |
| `ColumnCopy` | Column copy strategy for zero-downtime changes |
| `EventReplay` | Event replay strategy for perspective migrations |

#### MigrationFailureReason

Reason a migration failed:

| Value | Description |
|-------|-------------|
| `Unknown` (0) | Unknown failure reason |
| `SqlError` (1) | SQL execution error |
| `Timeout` (2) | Migration timed out |
| `ColumnTypeMismatch` (3) | Column type mismatch during copy |
| `DataCopyFailed` (4) | Data copy operation failed |
| `SwapFailed` (5) | Column swap operation failed |
