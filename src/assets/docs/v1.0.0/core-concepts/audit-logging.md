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
  - src/Whizbang.Core/SystemEvents/SystemEventStreams.cs
  - src/Whizbang.Core/Audit/AuditLogEntry.cs
  - src/Whizbang.Core/Audit/AuditLevel.cs
  - src/Whizbang.Core/Attributes/AuditEventAttribute.cs
  - tests/Whizbang.Core.Tests/SystemEvents/EventAuditedTests.cs
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

```csharp
// In Program.cs - BFF or any host that needs audit logging
services.AddWhizbang(options => {
  options.SystemEvents.EnableAudit();
});
```

### 2. Create Audit Perspective

```csharp
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

```csharp
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

```csharp
namespace Whizbang.Core.SystemEvents;

/// <summary>
/// Marker interface for Whizbang system events.
/// System events flow through normal event infrastructure but are stored separately.
/// </summary>
public interface ISystemEvent : IEvent { }
```

### EventAudited

The `EventAudited` event captures metadata about each domain event:

```csharp
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

```csharp
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

```csharp
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

```csharp
// Mark with audit reason for compliance queries
[AuditEvent(Reason = "PII access", Level = AuditLevel.Warning)]
public record CustomerDataViewed(Guid CustomerId, string ViewedBy) : IEvent;

// Critical operations get Critical level
[AuditEvent(Reason = "Financial transaction", Level = AuditLevel.Critical)]
public record PaymentProcessedEvent(Guid OrderId, decimal Amount) : IEvent;
```

---

## AuditEventAttribute

```csharp
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

## AuditLevel Enum

Categorize audit entries by severity:

```csharp
public enum AuditLevel {
  Info,     // Routine operations (default)
  Warning,  // Sensitive data access, unusual patterns
  Critical  // Financial transactions, security events
}
```

---

## Real-Time Alerts (Optional)

For real-time audit alerts in addition to durable persistence, use a tag hook:

```csharp
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

```sql
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

```csharp
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

```csharp
public async Task<IReadOnlyList<AuditLogEntry>> GetFinancialAuditTrailAsync(
    DateTimeOffset from, DateTimeOffset to, CancellationToken ct) {
  return await _auditLens.QueryAsync(q => q
      .Where(a => a.Timestamp >= from && a.Timestamp <= to)
      .Where(a => a.AuditReason == "Financial transaction")
      .OrderBy(a => a.Timestamp), ct);
}
```

### Critical Events Dashboard

```csharp
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
```csharp
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
- [System Events](system-events.md) - Full system events documentation
- [Perspectives](perspectives.md) - How perspectives work

**Implementation**:
- [Perspective Store](../data/perspective-store.md) - Storage patterns
- [Scoped Lenses](../lenses/scoped-lenses.md) - Multi-tenant queries
- [Tag Hooks](../messaging/tag-hooks.md) - Real-time event processing

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-01-22*
