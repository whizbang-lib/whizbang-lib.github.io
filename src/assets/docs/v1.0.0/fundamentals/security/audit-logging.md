---
title: Audit Logging
version: 1.0.0
category: Core Concepts
order: 7
description: >-
  Implement compliance-ready audit logging using Whizbang's System Events -
  capture who changed what, when, and why
tags: 'audit, compliance, logging, system-events, perspectives, security, gdpr, sox'
codeReferences:
  - src/Whizbang.Core/SystemEvents/ISystemEvent.cs
  - src/Whizbang.Core/SystemEvents/EventAudited.cs
  - src/Whizbang.Core/SystemEvents/CommandAudited.cs
  - src/Whizbang.Core/SystemEvents/SystemEventStreams.cs
  - src/Whizbang.Core/Audit/AuditLogEntry.cs
  - src/Whizbang.Core/Audit/CommandAuditEntry.cs
  - src/Whizbang.Core/Audit/AuditLevel.cs
  - src/Whizbang.Core/Attributes/AuditEventAttribute.cs
  - tests/Whizbang.Core.Tests/SystemEvents/EventAuditedTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/CommandAuditedTests.cs
lastMaintainedCommit: '01f07906'
---

# Audit Logging

Whizbang provides audit logging through **System Events** - internal events emitted by Whizbang for audit, monitoring, and operations. When audit is enabled, Whizbang emits an `EventAudited` system event for each domain event, which can be captured by a simple perspective.

## Core Concept

```
┌─────────────────────────────────────────────────────────────────┐
│  Domain Event Appended (OrderCreated, PaymentProcessed, ...)    │
│       │                                                          │
│       ▼                                                          │
│  [System Audit Enabled?] ──No──► (nothing emitted)              │
│       │                                                          │
│      Yes                                                         │
│       │                                                          │
│       ▼                                                          │
│  Emit EventAudited to $wb-system stream                         │
│       │                                                          │
│       ▼                                                          │
│  AuditPerspective : IPerspectiveFor<AuditLogEntry, EventAudited>│
│       │                                                          │
│       ▼                                                          │
│  wb_audit_log table (queryable via IAuditLogLens)               │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight**: System events dogfood Whizbang's own event infrastructure - no special interfaces needed.

**Benefits**:
- **Opt-in per host**: Enable audit in BFF, skip in background workers
- **Same infrastructure**: Events, perspectives, and lenses work identically
- **Exclude by exception**: All events audited by default, opt-out specific types
- **Dedicated stream**: System events isolated in `$wb-system` stream

---

## Quick Start

### 1. Enable System Audit

```csharp{title="Enable System Audit" description="Enable System Audit" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Enable", "System"]}
// In Program.cs - BFF or any host that needs audit logging
services.AddWhizbang(options => {
  options.SystemEvents.EnableAudit();
});
```

### 2. Create Audit Perspective

```csharp{title="Create Audit Perspective" description="Create Audit Perspective" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Create", "Audit"]}
using Whizbang.Core.Audit;
using Whizbang.Core.Perspectives;
using Whizbang.Core.SystemEvents;

/// <summary>
/// Perspective that captures EventAudited system events into queryable audit log.
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
      UserName = @event.UserName,
      CorrelationId = @event.CorrelationId,
      CausationId = @event.CausationId,
      Body = @event.OriginalBody,
      AuditReason = @event.AuditReason
    };
  }
}
```

### 3. Query Audit Log

```csharp{title="Query Audit Log" description="Query Audit Log" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Query", "Audit"]}
public interface IAuditLogLens : ILensQuery<AuditLogEntry> { }

public class ComplianceService {
  private readonly IAuditLogLens _auditLens;

  // Query: What did user X change?
  public async Task<IReadOnlyList<AuditLogEntry>> GetUserActivityAsync(
      string userId, CancellationToken ct) {
    return await _auditLens.QueryAsync(q => q
        .Where(a => a.UserId == userId)
        .OrderByDescending(a => a.Timestamp), ct);
  }

  // Query: Who changed entity X?
  public async Task<IReadOnlyList<AuditLogEntry>> GetEntityHistoryAsync(
      string streamId, CancellationToken ct) {
    return await _auditLens.QueryAsync(q => q
        .Where(a => a.StreamId == streamId)
        .OrderBy(a => a.StreamPosition), ct);
  }
}
```

---

## System Events

System events are internal Whizbang events stored in a dedicated `$wb-system` stream.

### ISystemEvent Interface

```csharp{title="ISystemEvent Interface" description="ISystemEvent Interface" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "ISystemEvent", "Interface"]}
namespace Whizbang.Core.SystemEvents;

/// <summary>
/// Marker interface for Whizbang system events.
/// System events flow through normal event infrastructure but are stored separately.
/// </summary>
public interface ISystemEvent : IEvent { }
```

### EventAudited

The `EventAudited` event captures metadata about each domain event:

```csharp{title="EventAudited" description="The EventAudited event captures metadata about each domain event:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "EventAudited"]}
public sealed record EventAudited : ISystemEvent {
  // Identity
  public required Guid Id { get; init; }

  // Original event info
  public required string OriginalEventType { get; init; }
  public required string OriginalStreamId { get; init; }
  public required long OriginalStreamPosition { get; init; }
  public required JsonElement OriginalBody { get; init; }
  public required DateTimeOffset Timestamp { get; init; }

  // Scope (who) - copied from event metadata
  public string? TenantId { get; init; }
  public string? UserId { get; init; }
  public string? UserName { get; init; }
  public string? CorrelationId { get; init; }
  public string? CausationId { get; init; }

  // Audit metadata
  public string? AuditReason { get; init; }
  public AuditLevel AuditLevel { get; init; } = AuditLevel.Info;
}
```

### Dedicated System Stream

```csharp{title="Dedicated System Stream" description="Dedicated System Stream" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Dedicated", "System"]}
public static class SystemEventStreams {
  /// <summary>The dedicated system event stream name.</summary>
  public static string Name => "$wb-system";

  /// <summary>Stream prefix for system events.</summary>
  public static string Prefix => "$wb-";
}
```

---

## Excluding Events from Audit

By default, **all events are audited** when system audit is enabled. Use `[AuditEvent(Exclude = true)]` to opt-out specific event types:

```csharp{title="Excluding Events from Audit" description="By default, all events are audited when system audit is enabled." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Excluding", "Events"]}
using Whizbang.Core.Attributes;

// High-frequency event - exclude from audit to avoid log bloat
[AuditEvent(Exclude = true, Reason = "High-frequency heartbeat event")]
public record HeartbeatEvent(Guid ServiceId) : IEvent;

// Temporary/internal event - exclude from compliance audit
[AuditEvent(Exclude = true, Reason = "Internal processing state, not user-facing")]
public record ProcessingStepCompleted(Guid WorkflowId, int Step) : IEvent;

// Normal events are audited automatically
public record OrderCreated(Guid OrderId, Guid CustomerId) : IEvent;
```

### Adding Audit Context

Use `[AuditEvent]` without `Exclude` to add context to audited events:

```csharp{title="Adding Audit Context" description="Use [AuditEvent] without Exclude to add context to audited events:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Adding", "Audit"]}
// Mark with audit reason for compliance queries
[AuditEvent(Reason = "PII access", Level = AuditLevel.Warning)]
public record CustomerDataViewed(Guid CustomerId, string ViewedBy) : IEvent;

// Critical operations get Critical level
[AuditEvent(Reason = "Financial transaction", Level = AuditLevel.Critical)]
public record PaymentProcessedEvent(Guid OrderId, decimal Amount) : IEvent;
```

---

<a id="command-auditing"></a>

## Command Auditing

In addition to event auditing, Whizbang supports **command auditing** to capture the intent behind changes. While events record what happened, command auditing records what was requested.

### CommandAudited System Event

When command auditing is enabled, Whizbang emits a `CommandAudited` system event for each command processed:

```csharp{title="CommandAudited System Event" description="When command auditing is enabled, Whizbang emits a CommandAudited system event for each command processed:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "CommandAudited", "System"]}
public sealed record CommandAudited : ISystemEvent {
  // Identity
  public required Guid Id { get; init; }

  // Command info
  public required string CommandType { get; init; }
  public required JsonElement CommandBody { get; init; }
  public required DateTimeOffset Timestamp { get; init; }

  // Result
  public required bool Succeeded { get; init; }
  public string? FailureReason { get; init; }

  // Scope (who)
  public string? TenantId { get; init; }
  public string? UserId { get; init; }
  public string? UserName { get; init; }
  public string? CorrelationId { get; init; }

  // Audit metadata
  public string? AuditReason { get; init; }
  public AuditLevel AuditLevel { get; init; } = AuditLevel.Info;
}
```

### Enabling Command Auditing

```csharp{title="Enabling Command Auditing" description="Enabling Command Auditing" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Enabling", "Command"]}
services.AddWhizbang(options => {
  options.SystemEvents.EnableAudit();         // Events only
  options.SystemEvents.EnableCommandAudit();  // Commands only
  options.SystemEvents.EnableFullAudit();     // Both events and commands
});
```

### Command Audit Perspective

```csharp{title="Command Audit Perspective" description="Command Audit Perspective" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Command", "Audit"]}
public sealed class CommandAuditPerspective
    : IPerspectiveFor<CommandAuditEntry, CommandAudited> {
  public CommandAuditEntry Apply(CommandAuditEntry current, CommandAudited @event) {
    return new CommandAuditEntry {
      Id = @event.Id,
      CommandType = @event.CommandType,
      CommandBody = @event.CommandBody,
      Timestamp = @event.Timestamp,
      Succeeded = @event.Succeeded,
      FailureReason = @event.FailureReason,
      TenantId = @event.TenantId,
      UserId = @event.UserId,
      UserName = @event.UserName,
      CorrelationId = @event.CorrelationId,
      AuditReason = @event.AuditReason,
      AuditLevel = @event.AuditLevel
    };
  }
}
```

### Querying Command Audit

```csharp{title="Querying Command Audit" description="Querying Command Audit" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Querying", "Command"]}
public interface ICommandAuditLens : ILensQuery<CommandAuditEntry> { }

public class SecurityService {
  private readonly ICommandAuditLens _commandAuditLens;

  // Find failed commands (potential attack vectors)
  public async Task<IReadOnlyList<CommandAuditEntry>> GetFailedCommandsAsync(
      DateTimeOffset since, CancellationToken ct) {
    return await _commandAuditLens.QueryAsync(q => q
        .Where(c => c.Timestamp >= since)
        .Where(c => !c.Succeeded)
        .OrderByDescending(c => c.Timestamp), ct);
  }

  // Correlate command to resulting events
  public async Task<CommandEventCorrelation> GetCommandWithEventsAsync(
      string correlationId, CancellationToken ct) {
    var command = await _commandAuditLens.QueryAsync(q => q
        .Where(c => c.CorrelationId == correlationId)
        .SingleOrDefault(), ct);

    var events = await _auditLens.QueryAsync(q => q
        .Where(e => e.CorrelationId == correlationId)
        .OrderBy(e => e.Timestamp), ct);

    return new CommandEventCorrelation(command, events);
  }
}
```

---

<a id="selective-auditing"></a>

## AuditEventAttribute

```csharp{title="AuditEventAttribute" description="AuditEventAttribute" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "AuditEventAttribute"]}
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct)]
public sealed class AuditEventAttribute : MessageTagAttribute {
  /// <summary>
  /// When true, excludes this event type from system audit.
  /// Default is false (all events audited when audit is enabled).
  /// </summary>
  public bool Exclude { get; init; }

  /// <summary>
  /// Optional reason documenting why this event requires/skips auditing.
  /// </summary>
  public string? Reason { get; init; }

  /// <summary>
  /// Audit severity level. Default is Info.
  /// </summary>
  public AuditLevel Level { get; init; } = AuditLevel.Info;
}
```

---

<a id="levels"></a>

## AuditLevel Enum

Categorize audit entries by severity:

```csharp{title="AuditLevel Enum" description="Categorize audit entries by severity:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "AuditLevel", "Enum"]}
public enum AuditLevel {
  Info,     // Routine operations (default)
  Warning,  // Sensitive data access, unusual patterns
  Critical  // Financial transactions, security events
}
```

---

## Real-Time Alerts (Optional)

For real-time audit alerts in addition to durable persistence, use a tag hook:

```csharp{title="Real-Time Alerts (Optional)" description="For real-time audit alerts in addition to durable persistence, use a tag hook:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Real-Time", "Alerts"]}
// Hook provides real-time logging/alerts
// Perspective provides durable persistence
services.AddWhizbang(options => {
  options.SystemEvents.EnableAudit();
  options.Tags.UseHook<AuditEventAttribute, AuditAlertHook>();
});

public sealed class AuditAlertHook : IMessageTagHook<AuditEventAttribute> {
  private readonly ILogger<AuditAlertHook> _logger;

  public ValueTask<JsonElement?> OnTaggedMessageAsync(
      TagContext<AuditEventAttribute> context, CancellationToken ct) {

    // Real-time logging - perspective handles persistence
    _logger.LogInformation(
      "Audit [{Level}]: {EventType} - {Reason}",
      context.Attribute.Level,
      context.MessageType.Name,
      context.Attribute.Reason);

    return ValueTask.FromResult<JsonElement?>(null);
  }
}
```

**Separation of concerns**:
- **Tag hook**: Real-time alerts, logging, external notifications
- **System Events + Perspective**: Durable persistence

---

## Database Schema

```sql{title="Database Schema" description="Database Schema" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Database", "Schema"]}
-- Audit log table (perspective store)
CREATE TABLE wb_audit_log (
    id UUID PRIMARY KEY,
    stream_id VARCHAR(255) NOT NULL,
    stream_position BIGINT NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    tenant_id VARCHAR(100),
    user_id VARCHAR(100),
    user_name VARCHAR(255),
    correlation_id VARCHAR(100),
    causation_id VARCHAR(100),
    body JSONB NOT NULL,
    audit_reason VARCHAR(500),
    audit_level VARCHAR(20)
);

-- Indexes for compliance queries
CREATE INDEX idx_audit_log_user_id ON wb_audit_log(user_id, timestamp DESC);
CREATE INDEX idx_audit_log_stream_id ON wb_audit_log(stream_id, stream_position);
CREATE INDEX idx_audit_log_tenant_timestamp ON wb_audit_log(tenant_id, timestamp DESC);
CREATE INDEX idx_audit_log_level ON wb_audit_log(audit_level) WHERE audit_level IN ('Warning', 'Critical');
```

---

## Compliance Patterns

### GDPR: User Activity Report

```csharp{title="GDPR: User Activity Report" description="GDPR: User Activity Report" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "GDPR:", "User"]}
public async Task<DataAccessReport> GenerateAccessReportAsync(
    string userId, CancellationToken ct) {
  var entries = await _auditLens.QueryAsync(q => q
      .Where(a => a.UserId == userId)
      .OrderByDescending(a => a.Timestamp), ct);

  return new DataAccessReport {
    UserId = userId,
    GeneratedAt = DateTimeOffset.UtcNow,
    AccessEvents = entries.ToList()
  };
}
```

### SOX: Financial Transaction Trail

```csharp{title="SOX: Financial Transaction Trail" description="SOX: Financial Transaction Trail" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "SOX:", "Financial"]}
public async Task<IReadOnlyList<AuditLogEntry>> GetFinancialAuditTrailAsync(
    DateTimeOffset from, DateTimeOffset to, CancellationToken ct) {
  return await _auditLens.QueryAsync(q => q
      .Where(a => a.Timestamp >= from && a.Timestamp <= to)
      .Where(a => a.AuditReason == "Financial transaction")
      .OrderBy(a => a.Timestamp), ct);
}
```

### Critical Events Dashboard

```csharp{title="Critical Events Dashboard" description="Critical Events Dashboard" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Critical", "Events"]}
public async Task<IReadOnlyList<AuditLogEntry>> GetCriticalEventsAsync(
    int hours, CancellationToken ct) {
  var since = DateTimeOffset.UtcNow.AddHours(-hours);
  return await _auditLens.QueryAsync(q => q
      .Where(a => a.Timestamp >= since)
      .Where(a => a.AuditLevel == AuditLevel.Critical)
      .OrderByDescending(a => a.Timestamp), ct);
}
```

---

## Best Practices

### DO

- **Enable audit per host**: Different services have different audit needs
- **Exclude high-frequency events**: Heartbeats, health checks, internal processing
- **Add audit reasons**: Document why events are audited for compliance
- **Use appropriate levels**: Info for routine, Warning for sensitive, Critical for financial
- **Index audit tables**: For common query patterns (user, tenant, timestamp)

### DON'T

- **Audit everything blindly**: Exclude non-essential events to manage storage
- **Store sensitive data**: Passwords, tokens, PII that shouldn't be retained
- **Skip the Reason**: Essential for compliance audits
- **Forget multi-tenancy**: Partition or filter by TenantId
- **Delete audit logs**: Without proper retention policies

---

## Other System Events

Audit is just one category of system events. Whizbang provides others for observability:

| Event | Description | Use Case |
|-------|-------------|----------|
| `EventAudited` | Domain event audited | Compliance, audit trail |
| `PerspectiveRebuilding` | Perspective rebuild started | Ops monitoring |
| `PerspectiveRebuilt` | Perspective rebuild completed | Ops monitoring |
| `ReceptorFailed` | Receptor threw exception | Error tracking |
| `MessageDeadLettered` | Message sent to DLQ | DLQ monitoring |

Enable specific categories:
```csharp{title="Other System Events" description="Enable specific categories:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Other", "System"]}
services.AddWhizbang(options => {
  options.SystemEvents.EnableAudit();           // EventAudited
  options.SystemEvents.EnablePerspectiveEvents(); // Rebuilding, rebuilt
  options.SystemEvents.EnableErrorEvents();      // Failed, dead-lettered
  options.SystemEvents.EnableAll();              // All system events
});
```

---

## Further Reading

**Core Concepts**:
- [System Events](../events/system-events.md) - Full system events documentation
- [Perspectives](../perspectives/perspectives.md) - How perspectives work

**Implementation**:
- Perspective Store - Storage patterns
- [Scoped Lenses](../lenses/scoped-lenses.md) - Multi-tenant queries
- Tag Hooks - Real-time event processing

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-01-22*
