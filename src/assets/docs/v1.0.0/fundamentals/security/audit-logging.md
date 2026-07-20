---
title: Audit Logging
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - src/Whizbang.Core/SystemEvents/SystemEventStream.cs
  - src/Whizbang.Core/SystemEvents/SystemEventOptions.cs
  - src/Whizbang.Core/SystemEvents/ISystemEventEmitter.cs
  - src/Whizbang.Core/SystemEvents/AuditingEventStoreDecorator.cs
  - src/Whizbang.Core/SystemEvents/CommandAuditPipelineBehavior.cs
  - src/Whizbang.Core/SystemEvents/Audit/AuditEventModel.cs
  - src/Whizbang.Core/Audit/AuditLogEntry.cs
  - src/Whizbang.Core/Audit/AuditLevel.cs
  - src/Whizbang.Core/Attributes/AuditEventAttribute.cs
testReferences:
  - tests/Whizbang.Core.Tests/SystemEvents/EventAuditedTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/CommandAuditTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/SystemEventOptionsTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditEventAttributeExcludeTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditingEventStoreDecoratorTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/CommandAuditPipelineBehaviorTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/SystemEventEmitterTests.cs
  - tests/Whizbang.Core.Tests/Audit/AuditEventAttributeTests.cs
  - tests/Whizbang.Core.Tests/Audit/AuditLevelTests.cs
  - tests/Whizbang.Core.Tests/Audit/AuditLogEntryTests.cs
lastMaintainedCommit: '01f07906'
---

# Audit Logging

Whizbang provides audit logging through **System Events** - internal events emitted by Whizbang for audit, monitoring, and operations. When audit is enabled, Whizbang emits an `EventAudited` system event for each domain event, which can be captured by a simple perspective.

## Core Concept

```mermaid{caption="System-audit emit path — a domain event is audited to the $wb-system stream only when audit is enabled; nothing is emitted when it is off." tests=["SystemEventEmitterTests.EmitEventAuditedAsync_WithEnabledAudit_EmitsEventAuditedToSystemStreamAsync", "SystemEventEmitterTests.EmitEventAuditedAsync_WhenEventAuditDisabled_DoesNotEmitAsync"]}
flowchart TD
    Appended["Domain Event Appended<br/>(OrderCreated, PaymentProcessed, ...)"]
    Enabled{"System Audit Enabled?"}
    Nothing["(nothing emitted)"]
    Emit["Emit EventAudited to $wb-system stream"]
    Perspective["AuditPerspective : IPerspectiveFor&lt;AuditLogEntry, EventAudited&gt;"]
    Table["Perspective store (queryable via ILensQuery&lt;AuditLogEntry&gt;)"]

    Appended --> Enabled
    Enabled -->|No| Nothing
    Enabled -->|Yes| Emit
    Emit --> Perspective
    Perspective --> Table
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

```csharp{title="Enable System Audit" description="Enable System Audit" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Enable", "System"] tests=["CommandAuditTests.EnableAudit_EnablesBothEventAndCommandAudit_Async", "SystemEventOptionsTests.EnableAudit_SetsAuditEnabled_ReturnsThisForFluentApiAsync"]}
// In Program.cs - BFF or any host that needs audit logging
services.AddWhizbang(options => {
  options.SystemEvents.EnableAudit();   // Enables BOTH event and command auditing
  // options.SystemEvents.EnableEventAudit();   // Events only
  // options.SystemEvents.EnableCommandAudit(); // Commands only
});
```

System events are **local-only by default** (`SystemEventOptions.LocalOnly = true`): each host audits the events it processes but does not rebroadcast audit events to the outbox/inbox, which prevents duplicate audit entries when multiple hosts enable audit. Call `options.SystemEvents.Broadcast()` for the advanced centralized-collection scenario.

### 2. Create Audit Perspective

```csharp{title="Create Audit Perspective" description="Create Audit Perspective" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Create", "Audit"] unverified="consumer perspective illustration — AuditPerspective is user code, not a shipped Whizbang API"}
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
      // EventAudited carries no UserName property; resolve display names from
      // the Scope dictionary (@event.Scope) or a user lookup if you need them.
      CorrelationId = @event.CorrelationId,
      CausationId = @event.CausationId,
      Body = @event.OriginalBody,
      AuditReason = @event.AuditReason
    };
  }
}
```

### 3. Query Audit Log

Inject `ILensQuery<AuditLogEntry>` and query through the fluent scope API — `Scope(QueryScope.X).Query` (or `DefaultScope.Query`) returns an `IQueryable<PerspectiveRow<AuditLogEntry>>` with scope filters pre-applied; the model lives on `row.Model`:

```csharp{title="Query Audit Log" description="Query Audit Log" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Query", "Audit"] unverified="ILensQuery scope query — verified in the Scoped Lenses docs, not by these audit tests"}
public class ComplianceService {
  private readonly ILensQuery<AuditLogEntry> _auditLens;

  public ComplianceService(ILensQuery<AuditLogEntry> auditLens) => _auditLens = auditLens;

  // Query: What did user X change?
  public async Task<IReadOnlyList<AuditLogEntry>> GetUserActivityAsync(
      string userId, CancellationToken ct) {
    var rows = await _auditLens.Scope(QueryScope.Global).Query
        .Where(r => r.Model.UserId == userId)
        .OrderByDescending(r => r.Model.Timestamp)
        .ToListAsync(ct);
    return rows.Select(r => r.Model).ToList();
  }

  // Query: Who changed entity X?
  public async Task<IReadOnlyList<AuditLogEntry>> GetEntityHistoryAsync(
      string streamId, CancellationToken ct) {
    var rows = await _auditLens.Scope(QueryScope.Global).Query
        .Where(r => r.Model.StreamId == streamId)
        .OrderBy(r => r.Model.StreamPosition)
        .ToListAsync(ct);
    return rows.Select(r => r.Model).ToList();
  }
}
```

---

## System Events

System events are internal Whizbang events stored in a dedicated `$wb-system` stream.

### ISystemEvent Interface

```csharp{title="ISystemEvent Interface" description="ISystemEvent Interface" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "ISystemEvent", "Interface"] tests=["EventAuditedTests.EventAudited_ImplementsISystemEvent_ForSystemStreamRoutingAsync", "CommandAuditTests.CommandAudited_ImplementsISystemEvent_Async"]}
namespace Whizbang.Core.SystemEvents;

/// <summary>
/// Marker interface for Whizbang system events.
/// System events flow through normal event infrastructure but are stored separately.
/// </summary>
public interface ISystemEvent : IEvent { }
```

### EventAudited

The `EventAudited` event captures metadata about each domain event:

```csharp{title="EventAudited" description="The EventAudited event captures metadata about each domain event:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "EventAudited"] tests=["EventAuditedTests.EventAudited_CapturesOriginalEventType_ForAuditTrailAsync", "EventAuditedTests.EventAudited_CapturesStreamInfo_ForEventLocationAsync", "EventAuditedTests.EventAudited_CapturesOriginalBody_ForFullEventDataAsync", "EventAuditedTests.EventAudited_CapturesScopeInfo_ForComplianceQueriesAsync", "EventAuditedTests.EventAudited_CapturesAuditReason_WhenAttributePresentAsync"]}
public sealed record EventAudited : ISystemEvent {
  // Identity
  public required Guid Id { get; init; }
  public Guid OriginalEventId { get; init; }

  // Original event info
  public required string OriginalEventType { get; init; }
  public required string OriginalStreamId { get; init; }
  public required long OriginalStreamPosition { get; init; }
  public required JsonElement OriginalBody { get; init; }
  public required DateTimeOffset Timestamp { get; init; }

  // Scope (who) - copied from event metadata
  public string? TenantId { get; init; }
  public string? UserId { get; init; }
  public string? CorrelationId { get; init; }
  public string? CausationId { get; init; }

  // Audit metadata
  public string? AuditReason { get; init; }
  public AuditLevel AuditLevel { get; init; } = AuditLevel.Info;

  // Full scope key/value pairs from the originating envelope
  public IReadOnlyDictionary<string, string?>? Scope { get; init; }
}
```

### Dedicated System Stream

```csharp{title="Dedicated System Stream" description="Dedicated System Stream" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Dedicated", "System"] unverified="SystemEventStream constants are verified by ISystemEventTests, outside this page's referenced audit tests"}
public static class SystemEventStream {
  /// <summary>The dedicated system event stream name.</summary>
  public static string Name => "$wb-system";

  /// <summary>Stream prefix for system events.</summary>
  public static string Prefix => "$wb-";
}
```

---

## Excluding Events from Audit

By default, **all events are audited** when system audit is enabled (`SystemEventOptions.AuditMode = AuditMode.OptOut`). Use `[AuditEvent(Exclude = true)]` to opt-out specific event types. Alternatively, set `options.SystemEvents.AuditMode = AuditMode.OptIn` to audit **only** events explicitly marked with `[AuditEvent]`.

```csharp{title="Excluding Events from Audit" description="By default, all events are audited when system audit is enabled." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Excluding", "Events"] tests=["AuditingEventStoreDecoratorTests.ShouldAudit_OptOut_ExcludesMarkedEventsAsync", "AuditingEventStoreDecoratorTests.ShouldAudit_OptOut_AuditsRegularEventsAsync", "SystemEventEmitterTests.ShouldExcludeFromAudit_WithExcludedAttribute_ReturnsTrueAsync"]}
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

```csharp{title="Adding Audit Context" description="Use [AuditEvent] without Exclude to add context to audited events:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Adding", "Audit"] tests=["AuditEventAttributeTests.AuditEventAttribute_CanBeAppliedToEventRecordAsync", "AuditEventAttributeTests.AuditEventAttribute_Reason_CanBeSetAsync", "AuditEventAttributeTests.AuditEventAttribute_Level_CanBeSetAsync"]}
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

```csharp{title="CommandAudited System Event" description="When command auditing is enabled, Whizbang emits a CommandAudited system event for each command processed:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "CommandAudited", "System"] tests=["CommandAuditTests.CommandAudited_HasRequiredProperties_Async", "CommandAuditTests.CommandAudited_ImplementsISystemEvent_Async"]}
public sealed record CommandAudited : ISystemEvent {
  // Identity
  public required Guid Id { get; init; }

  // Command info
  public required string CommandType { get; init; }
  public required JsonElement CommandBody { get; init; }
  public required DateTimeOffset Timestamp { get; init; }

  // Scope (who)
  public string? TenantId { get; init; }
  public string? UserId { get; init; }
  public string? UserName { get; init; }
  public string? CorrelationId { get; init; }
  public string? CausationId { get; init; }

  // Audit metadata
  public string? AuditReason { get; init; }
  public AuditLevel AuditLevel { get; init; } = AuditLevel.Info;

  // Processing info
  public string? ReceptorName { get; init; }
  public string? ResponseType { get; init; }

  // Full scope key/value pairs from the originating envelope
  public IReadOnlyDictionary<string, string?>? Scope { get; init; }
}
```

### Enabling Command Auditing

```csharp{title="Enabling Command Auditing" description="Enabling Command Auditing" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Enabling", "Command"] tests=["CommandAuditTests.EnableEventAudit_OnlyEnablesEventAudit_Async", "CommandAuditTests.EnableCommandAudit_OnlyEnablesCommandAudit_Async", "CommandAuditTests.EnableAudit_EnablesBothEventAndCommandAudit_Async"]}
services.AddWhizbang(options => {
  options.SystemEvents.EnableEventAudit();    // Events only
  options.SystemEvents.EnableCommandAudit();  // Commands only
  options.SystemEvents.EnableAudit();         // Both events and commands
});
```

### Command Audit Perspective

```csharp{title="Command Audit Perspective" description="Command Audit Perspective" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Command", "Audit"] unverified="consumer perspective illustration — CommandAuditPerspective is user code, not a shipped Whizbang API"}
// CommandAuditEntry is YOUR perspective model — Whizbang ships the CommandAudited
// system event; you define the shape you want to persist and query.
public sealed class CommandAuditPerspective
    : IPerspectiveFor<CommandAuditEntry, CommandAudited> {
  public CommandAuditEntry Apply(CommandAuditEntry current, CommandAudited @event) {
    return new CommandAuditEntry {
      Id = @event.Id,
      CommandType = @event.CommandType,
      CommandBody = @event.CommandBody,
      Timestamp = @event.Timestamp,
      TenantId = @event.TenantId,
      UserId = @event.UserId,
      UserName = @event.UserName,
      CorrelationId = @event.CorrelationId,
      ReceptorName = @event.ReceptorName,
      ResponseType = @event.ResponseType,
      AuditReason = @event.AuditReason,
      AuditLevel = @event.AuditLevel
    };
  }
}
```

### Querying Command Audit

```csharp{title="Querying Command Audit" description="Querying Command Audit" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Querying", "Command"] unverified="ILensQuery scope query — verified in the Scoped Lenses docs, not by these audit tests"}
public class SecurityService {
  private readonly ILensQuery<CommandAuditEntry> _commandAuditLens;
  private readonly ILensQuery<AuditLogEntry> _auditLens;

  // Recent activity for a command type (e.g. anomaly review)
  public async Task<IReadOnlyList<CommandAuditEntry>> GetRecentCommandsAsync(
      string commandType, DateTimeOffset since, CancellationToken ct) {
    var rows = await _commandAuditLens.Scope(QueryScope.Global).Query
        .Where(r => r.Model.Timestamp >= since)
        .Where(r => r.Model.CommandType == commandType)
        .OrderByDescending(r => r.Model.Timestamp)
        .ToListAsync(ct);
    return rows.Select(r => r.Model).ToList();
  }

  // Correlate command to resulting events
  public async Task<CommandEventCorrelation> GetCommandWithEventsAsync(
      string correlationId, CancellationToken ct) {
    var commandRows = await _commandAuditLens.Scope(QueryScope.Global).Query
        .Where(r => r.Model.CorrelationId == correlationId)
        .ToListAsync(ct);
    var command = commandRows.Select(r => r.Model).SingleOrDefault();

    var eventRows = await _auditLens.Scope(QueryScope.Global).Query
        .Where(r => r.Model.CorrelationId == correlationId)
        .OrderBy(r => r.Model.Timestamp)
        .ToListAsync(ct);

    return new CommandEventCorrelation(command, eventRows.Select(r => r.Model).ToList());
  }
}
```

---

<a id="selective-auditing"></a>

## AuditEventAttribute

```csharp{title="AuditEventAttribute" description="AuditEventAttribute" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "AuditEventAttribute"] tests=["AuditEventAttributeTests.AuditEventAttribute_InheritsFromMessageTagAttributeAsync", "AuditEventAttributeTests.AuditEventAttribute_Tag_DefaultsToAuditAsync", "AuditEventAttributeTests.AuditEventAttribute_AttributeUsage_AllowsClassTargetAsync", "AuditEventAttributeTests.AuditEventAttribute_AttributeUsage_DoesNotAllowMultipleAsync", "AuditEventAttributeTests.AuditEventAttribute_AttributeUsage_AllowsInheritedAsync", "AuditEventAttributeTests.AuditEventAttribute_Level_DefaultsToInfoAsync"]}
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, AllowMultiple = false, Inherited = true)]
public sealed class AuditEventAttribute : MessageTagAttribute {
  /// <summary>Sets Tag = "audit" so the event routes through the tag system.</summary>
  public AuditEventAttribute() {
    Tag = "audit";
  }

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

```csharp{title="AuditLevel Enum" description="Categorize audit entries by severity:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "AuditLevel", "Enum"] tests=["AuditLevelTests.AuditLevel_HasThreeValuesAsync", "AuditLevelTests.AuditLevel_Info_IsDefaultAsync", "AuditLevelTests.AuditLevel_Info_IsDefinedAsync", "AuditLevelTests.AuditLevel_Warning_IsDefinedAsync", "AuditLevelTests.AuditLevel_Critical_IsDefinedAsync", "AuditLevelTests.AuditLevel_SeverityOrder_IsCorrectAsync"]}
public enum AuditLevel {
  Info,     // Routine operations (default)
  Warning,  // Sensitive data access, unusual patterns
  Critical  // Financial transactions, security events
}
```

---

## Real-Time Alerts (Optional)

For real-time audit alerts in addition to durable persistence, use a tag hook:

```csharp{title="Real-Time Alerts (Optional)" description="For real-time audit alerts in addition to durable persistence, use a tag hook:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Real-Time", "Alerts"] unverified="tag-hook wiring (IMessageTagHook / Tags.UseHook) — verified in the Tag Hooks docs, not by these audit tests"}
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

Perspective models are persisted by Whizbang's perspective store automatically — you don't create this table by hand. The DDL below is an **illustrative reporting-table shape** for teams that materialize audit entries into a custom table:

```sql{title="Database Schema" description="Illustrative audit reporting table shape" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Database", "Schema"]}
-- Example audit log reporting table
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

```csharp{title="GDPR: User Activity Report" description="GDPR: User Activity Report" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "GDPR:", "User"] unverified="ILensQuery scope query — verified in the Scoped Lenses docs, not by these audit tests"}
public async Task<DataAccessReport> GenerateAccessReportAsync(
    string userId, CancellationToken ct) {
  var rows = await _auditLens.Scope(QueryScope.Global).Query
      .Where(r => r.Model.UserId == userId)
      .OrderByDescending(r => r.Model.Timestamp)
      .ToListAsync(ct);

  return new DataAccessReport {
    UserId = userId,
    GeneratedAt = DateTimeOffset.UtcNow,
    AccessEvents = rows.Select(r => r.Model).ToList()
  };
}
```

### SOX: Financial Transaction Trail

```csharp{title="SOX: Financial Transaction Trail" description="SOX: Financial Transaction Trail" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "SOX:", "Financial"] unverified="ILensQuery scope query — verified in the Scoped Lenses docs, not by these audit tests"}
public async Task<IReadOnlyList<AuditLogEntry>> GetFinancialAuditTrailAsync(
    DateTimeOffset from, DateTimeOffset to, CancellationToken ct) {
  var rows = await _auditLens.Scope(QueryScope.Global).Query
      .Where(r => r.Model.Timestamp >= from && r.Model.Timestamp <= to)
      .Where(r => r.Model.AuditReason == "Financial transaction")
      .OrderBy(r => r.Model.Timestamp)
      .ToListAsync(ct);
  return rows.Select(r => r.Model).ToList();
}
```

### Critical Events Dashboard

The shipped `AuditLogEntry` model does **not** carry `AuditLevel` — to power a level-based dashboard, define your own perspective model that maps `@event.AuditLevel` in `Apply`:

```csharp{title="Critical Events Dashboard" description="Critical Events Dashboard" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Critical", "Events"] unverified="ILensQuery scope query over a user-defined model — verified in the Scoped Lenses docs, not by these audit tests"}
// LeveledAuditEntry is your own model with an AuditLevel property,
// populated from EventAudited.AuditLevel in your perspective's Apply.
public async Task<IReadOnlyList<LeveledAuditEntry>> GetCriticalEventsAsync(
    int hours, CancellationToken ct) {
  var since = DateTimeOffset.UtcNow.AddHours(-hours);
  var rows = await _leveledAuditLens.Scope(QueryScope.Global).Query
      .Where(r => r.Model.Timestamp >= since)
      .Where(r => r.Model.AuditLevel == AuditLevel.Critical)
      .OrderByDescending(r => r.Model.Timestamp)
      .ToListAsync(ct);
  return rows.Select(r => r.Model).ToList();
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

Audit is one category of system events. `SystemEventOptions` reserves flags for other categories:

| Category | Enable Method | Events |
|----------|---------------|--------|
| Audit | `EnableAudit()` / `EnableEventAudit()` / `EnableCommandAudit()` | `EventAudited`, `CommandAudited` |
| Perspective events | `EnablePerspectiveEvents()` | Perspective rebuild notifications (planned) |
| Error events | `EnableErrorEvents()` | Receptor failure / dead-letter notifications (planned) |

:::updated
Shipped behavior: only `EventAudited` and `CommandAudited` system event types exist today. The `EnablePerspectiveEvents()` / `EnableErrorEvents()` flags are present on `SystemEventOptions`, but the corresponding event types (perspective rebuild, receptor failure, dead-letter) are not yet emitted — `SystemEventOptions.IsEnabled(...)` returns `false` for anything other than the two audit events.
:::

Enable specific categories:
```csharp{title="Other System Events" description="Enable specific categories:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Other", "System"] tests=["SystemEventOptionsTests.EnableAll_SetsAllFlags_ReturnsThisForFluentApiAsync", "SystemEventOptionsTests.EnablePerspectiveEvents_SetsPerspectiveEventsEnabled_Async", "SystemEventOptionsTests.EnableErrorEvents_SetsErrorEventsEnabled_Async", "SystemEventOptionsTests.EnableAudit_SetsAuditEnabled_ReturnsThisForFluentApiAsync"]}
services.AddWhizbang(options => {
  options.SystemEvents.EnableAudit();             // EventAudited + CommandAudited
  options.SystemEvents.EnablePerspectiveEvents(); // Reserved (no events emitted yet)
  options.SystemEvents.EnableErrorEvents();       // Reserved (no events emitted yet)
  options.SystemEvents.EnableAll();               // All of the above
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
