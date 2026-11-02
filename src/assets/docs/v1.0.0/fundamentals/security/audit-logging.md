---
title: Audit Logging
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Core Concepts
order: 7
description: >-
  Implement compliance-ready audit logging using Whizbang's System Events -
  capture who changed what, when, and why
tags: 'audit, compliance, logging, system-events, perspectives, security, gdpr, sox'
codeReferences:
  - src/Whizbang.Core/Audit/IBoundedCommandAudit.cs
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
  - src/Whizbang.Core/SystemEvents/AuditLedger.cs
  - src/Whizbang.Core/SystemEvents/AuditEligibility.cs
  - src/Whizbang.Core/SystemEvents/AuditOutboxMessageBuilder.cs
  - src/Whizbang.Core/SystemEvents/AuditLedgerRebuild.cs
  - src/Whizbang.Core/Commands/System/RequestAuditRebuildCommand.cs
  - src/Whizbang.Data.EFCore.Postgres/AuditRebuildRequestReceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/RedeliveryRequestReceptorRegistrar.cs
testReferences:
  - tests/Whizbang.Core.Tests/SystemEvents/CommandAuditListLengthsTests.cs
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
  - tests/Whizbang.Core.Tests/SystemEvents/AuditLedgerTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditDecisionHookCallSiteTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AuditRecordStreamPositionSqlTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditEphemeralExclusionTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditOutboxMessageBuilderTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditDependencyInjectionWiringTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/SystemEventEmitterRegistrationTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditLedgerRebuildTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AuditRebuildRequestReceptorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RedeliveryRequestReceptorTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ControlPlaneTypeRegistryTests.cs
  - tests/Whizbang.Core.Tests/Tags/SystemControlTagTests.cs
lastMaintainedCommit: '01f07906'
---

# Audit Logging

Whizbang provides audit logging through **System Events** - internal events emitted by Whizbang for audit, monitoring, and operations. When audit is enabled, Whizbang emits an `EventAudited` system event for each domain event, which can be captured by a simple perspective.

## Core Concept

```mermaid{caption="System-audit emit path: a domain event is audited to its tenant's audit ledger only when audit is enabled; nothing is emitted when it is off." tests=["SystemEventEmitterTests.EmitEventAuditedAsync_WithEnabledAudit_EmitsEventAuditedToTheAuditLedgerAsync", "SystemEventStreamRoutingTests.EmitEventAudited_AppendsToTheTenantsAuditLedgerAsync", "SystemEventEmitterTests.EmitEventAuditedAsync_WhenEventAuditDisabled_DoesNotEmitAsync"]}
flowchart TD
    Appended["Domain Event Appended<br/>(OrderCreated, PaymentProcessed, ...)"]
    Enabled{"System Audit Enabled?"}
    Nothing["(nothing emitted)"]
    Emit["Emit EventAudited to the tenant's audit ledger"]
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
- **Dedicated streams**: audit records on one ledger stream per tenant, the global system events on `$wb-system`

---

## Quick Start

### 1. Enable System Audit

```csharp{title="Enable System Audit" description="Enable System Audit" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Enable", "System"] tests=["CommandAuditTests.EnableAudit_EnablesBothEventAndCommandAudit_Async", "SystemEventOptionsTests.EnableAudit_SetsAuditEnabled_ReturnsThisForFluentApiAsync"]}
// In Program.cs - BFF or any host that needs audit logging.
// Call AFTER storage registration so the event store can be decorated.
services.AddSystemEvents(options => {
  options.EnableAudit();   // Enables BOTH event and command auditing
  // options.EnableEventAudit();   // Events only
  // options.EnableCommandAudit(); // Commands only
});
```

System events are **local-only by default** (`SystemEventOptions.LocalOnly = true`): each host audits the events it processes but does not rebroadcast audit events to the outbox/inbox, which prevents duplicate audit entries when multiple hosts enable audit. Call `options.Broadcast()` for the advanced centralized-collection scenario.

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

## Delivery Model: Durable, Not Real-Time

:::planned
Sliding-window audit shipping is being implemented; the durability guarantee below already holds today.
:::

Audit records are **durable from the instant the audited event commits** — the audit outbox row is
written in the *same transaction* as the audited event, so no audit record can ever be lost.
Everything after that commit is delivery, and delivery is deliberately **lazy**: audit consumers are
dashboards and compliance queries, not workflows, so audit traffic must never compete with
interactive or bulk domain traffic for transport capacity.

Shipping rides the generic **tag-bound coalescing** feature (see the *Tag-Bound Policies &
Message Coalescing* proposal): `EventAudited` carries the built-in reserved tag
**`SystemTags.Audit` (`"sys-audit"`)**, and `EnableAudit()` ships that tag's coalesce binding
with defaults — a **sliding window with a hard freshness cap**:

- Each new audit record resets a quiet timer (`SlideSeconds`, default 15). Shipping fires when
  the stream goes quiet — a bulk operation's entire audit trail coalesces and ships at burst-end.
- `MaxDelaySeconds` (default 120) bounds staleness: a continuous stream still ships at least
  every max-delay interval, oldest-first.
- Matured records ship as **`AuditEventsComposite` batch envelopes** (wire-only, capped at
  `MaxBatchCount` records, default 500, and `MaxBatchBytes` of payload, default 192,000), fanning out to
  per-record inbox rows at the consumer. An audit record carries the original message's body, so a batch
  of large records splits by size before it reaches the record count. Before 0.2623.1 only the count was
  capped, and 500 large records could become one message no broker accepts. A bulk
  import that produces thousands of audit records crosses the wire as a handful of envelopes
  instead of thousands of individual messages.
- **Failure degrades to slower, never to loss**: every audit row is minted with the
  `ScheduledFor = now + MaxDelaySeconds` safety floor; if the coalescer is unavailable, matured
  rows are released to the ordinary outbox publisher and ship individually.
- Audit envelopes carry the audited event's security scope (or an explicit system authority). A
  consumer that cannot attribute an audit records it as **unattributed** — the audit trail never
  fails, retries, or dead-letters over attribution.

**The defaults ship automatically but are yours to override** — bind the same tag in host
options and your binding replaces the built-in one:

```csharp{title="Override the audit shipping cadence" description="Bind SystemTags.Audit yourself to replace the shipped defaults" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Audit", "Coalescing"] unverified="tag-bound coalescing is an unreleased design (see the Tag-Bound Policies proposal)"}
services.AddWhizbang(options => {
  options.Tags.Coalesce(SystemTags.Audit, c => {
    c.SlideSeconds = 30;
    c.MaxDelaySeconds = 300;   // relax audit freshness to 5 minutes
  });
});
```

Set `SlideSeconds = 0` on the binding to restore immediate per-record shipping.

## System Events

System events are internal Whizbang events stored apart from domain events: audit records on their tenant's [audit ledger](#audit-ledger), the global kinds (security and advisory) on the dedicated `$wb-system` stream.

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
  // Identity: Id is AuditLedger.RecordIdFor(OriginalEventId), one record per audited event
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

```csharp{title="Dedicated System Stream" description="Dedicated System Stream" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Dedicated", "System"] unverified="SystemEventStreams constants are verified by ISystemEventTests, outside this page's referenced audit tests"}
public static class SystemEventStreams {
  /// <summary>The dedicated system event stream name.</summary>
  public static string Name => "$wb-system";

  /// <summary>Stream prefix for system events.</summary>
  public static string Prefix => "$wb-";

  /// <summary>Well-known stream ID the global system events are appended to.</summary>
  public static Guid StreamId { get; } = new("00000000-0000-0000-0000-000000000001");
}
```

`SystemEventStreams.StreamId` holds only the global kinds: security records and advisories. Audit records never use it, whichever path produced them: the work coordinator's outbox path and the `SystemEventEmitter` (`EmitEventAuditedAsync`, `EmitCommandAuditedAsync`, or an audit record given to `EmitAsync`) all write them on the tenant's audit ledger, below. `SystemEventStreams.StreamFor(systemEvent)` is the one place that decides. Earlier versions of the emitter wrote its audit records on `$wb-system`; a reader that looked for them there reads the ledger instead.

### The per-tenant audit ledger {#audit-ledger}

{verified: AuditLedgerTests.For_SameTenant_IsTheSameStreamAsync, AuditLedgerTests.For_DifferentTenants_AreDifferentStreamsAsync, AuditLedgerTests.For_NoTenant_IsTheEmptyTenantLedgerAsync, AuditRecordStreamPositionSqlTests.Store_RecordOnTheTenantLedger_IsStoredOnTheLedgerStreamAsync}

Each tenant's audit records share one stream, `AuditLedger.StreamFor(tenantId)`. It is a name-based (version 5) UUID of the tenant id under the namespace `UUIDv5(nil, "sys-audit")`, so every service derives the same id without coordination; records with no tenant share the empty-tenant ledger. Publishing on one stream per tenant keeps a tenant's audit trail ordered and owned by one instance at a time.

A coalesced bundle of audit records rides the ledger stream. Each record fanned out of it keeps its own id as its stream, so the audit perspective still holds one row per record rather than folding a tenant's whole trail into one row.

### One record per audited event {#record-ids}

{verified: AuditLedgerTests.RecordIdFor_KnownEvent_MatchesTheReferenceVectorAsync, AuditLedgerTests.RecordIdFor_SameEvent_IsTheSameRecordAsync, AuditLedgerTests.RecordIdFor_AnEventId_IsNeverTheEventIdItselfAsync, AuditOutboxMessageBuilderTests.TryBuildAuditMessage_TheRecordId_IsDerivedFromTheAuditedEventAsync, AuditOutboxMessageBuilderTests.TryBuildAuditMessage_BuiltTwiceForOneEvent_IsOneRecordAsync, AuditingEventStoreDecoratorTests.AppendAsync_TheRecordId_IsDerivedFromTheAuditedEventAsync, SystemEventEmitterTests.EmitEventAuditedAsync_TheRecordId_IsDerivedFromTheAuditedEventAsync}

An audit record's `Id` is derived from the event it audits: `AuditLedger.RecordIdFor(originalEventId)`, a name-based (version 5) UUID of the event id, written in its 36-character lower-case form, under the namespace `UUIDv5(nil, "sys-audit-record")`. The outbox path, the event store decorator, the emitter and the [ledger rebuild](#rebuilding-the-audit-ledger) all use it. Postgres computes the same id with `uuid_generate_v5(uuid_generate_v5(uuid_nil(), 'sys-audit-record'), original_event_id::text)`.

**Why.** An audit record is a function of the event it audits and that event's scope, so two records of one event are one fact. The built-in audit perspective keys a record by its `Id`, so a record delivered twice (by a retry, by two writers, or by a rebuild) replaces its row instead of adding one. The namespace is separate from the ledger's, so a record id is never a ledger stream id, and a record id is never the audited event's own id, because the record is stored as an event of its own. **Never change the derivation:** a rebuild must derive the ids the records already carry.

### The audit decision hook applies on every path {#audit-decision-hook}

{verified: AuditDecisionHookCallSiteTests.Scoped_VetoingHook_SuppressesTheAuditRecordAsync, AuditDecisionHookCallSiteTests.Immediate_VetoingHook_SuppressesTheAuditRecordAsync, AuditDecisionHookCallSiteTests.StreamAffinity_VetoingHook_SuppressesTheAuditRecordAsync, AuditDecisionHookCallSiteTests.Factory_Scoped_PassesTheRegisteredHookAsync}

The registered `IAuditDecisionHook` can veto or name an audit record wherever one is produced: the scoped, immediate and stream-affinity work coordinator strategies, the event store decorator, and the system event emitter. Before this release the outbox path skipped it. The default registration is `NoOpinionAuditDecisionHook`, which leaves the `[AuditEvent]` decision as it is; register your own to override it.

---

## Excluding Events from Audit

By default, **all events are audited** when system audit is enabled (`SystemEventOptions.AuditMode = AuditMode.OptOut`). Use `[AuditEvent(Exclude = true)]` to opt-out specific event types. Alternatively, set `options.AuditMode = AuditMode.OptIn` inside `AddSystemEvents(...)` to audit **only** events explicitly marked with `[AuditEvent]`.

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

### Ephemeral events are not audited by default {#ephemeral-events}

{verified: AuditEphemeralExclusionTests.AnEphemeralType_IsNotAuditedByDefaultAsync, AuditEphemeralExclusionTests.TheSameType_NotEphemeral_IsAuditedAsync, AuditEphemeralExclusionTests.AnEphemeralTypeMarkedForAudit_WithoutItsBody_IsStillNotAuditedAsync, AuditEphemeralExclusionTests.AnEphemeralTypeThatKeepsItsBody_IsAuditedAsync, AuditEphemeralExclusionTests.AHookThatRecordsEverything_DoesNotReopenAnEphemeralTypeAsync, AuditEphemeralExclusionTests.AHookThatRecordsEverything_IsHonoredForADurableTypeAsync, AuditOutboxMessageBuilderTests.TryBuildAuditMessage_AnEphemeralEvent_IsNotAuditedAsync, AuditOutboxMessageBuilderTests.TryBuildAuditMessage_TheDefaultSetToInclude_DoesNotOptInAnEphemeralEventAsync, AuditingEventStoreDecoratorTests.AppendAsync_AnEphemeralEvent_IsNotAuditedAsync, SystemEventEmitterTests.EmitEventAuditedAsync_AnEphemeralEvent_RecordsNothingAsync}

An [ephemeral](../events/ephemeral-events.md) event type is not audited, whatever the mode, unless the type keeps its body with `[AuditEvent(IncludeBody = true)]`. Its origin reaps the event once it is consumed, and an audit record holds a pointer to the event by default, so a record of an ephemeral event would point at nothing. Keeping the body is the opt-in because it is the one thing that keeps such a record meaningful:

```csharp{title="Auditing an ephemeral event type" description="An ephemeral type is audited only when its records keep its body, because its origin reaps the event they would point at." framework="NET10" category="Best-Practices" difficulty="INTERMEDIATE" tags=["audit", "ephemeral-events", "include-body"] tests=["AuditEphemeralExclusionTests.AnEphemeralTypeThatKeepsItsBody_IsAuditedAsync", "AuditOutboxMessageBuilderTests.TryBuildAuditMessage_AnEphemeralEventThatKeepsItsBody_IsAuditedWithItAsync"]}
// Not audited: ephemeral, and its records would point at a reaped event.
[Ephemeral]
public record UserIsTyping(Guid ConversationId, Guid UserId) : IEvent;

// Audited, with the body copied into every record.
[Ephemeral]
[AuditEvent(IncludeBody = true, Reason = "Session sign-in attempts are reviewed")]
public record SignInAttempted(Guid SessionId, string Outcome) : IEvent;
```

The choices, each held by a test:

- **Marking the type for audit is not the opt-in.** `[AuditEvent(Reason = ...)]` without `IncludeBody` still leaves an ephemeral type unaudited, even under `AuditMode.OptIn`, because its records would still dangle (`AnEphemeralTypeMarkedForAudit_WithoutItsBody_IsStillNotAuditedAsync`).
- **The process-wide body default does not opt in.** `AuditBodyDefault = Include` keeps bodies for the types that are audited; it does not turn every high-churn ephemeral type (presence, typing, progress) into audit traffic at once (`TryBuildAuditMessage_TheDefaultSetToInclude_DoesNotOptInAnEphemeralEventAsync`).
- **A decision hook cannot reopen an ephemeral type.** The exclusion is decided before the hook, as the self-audit exclusion is: a hook judges an occurrence but cannot keep its body (`AHookThatRecordsEverything_DoesNotReopenAnEphemeralTypeAsync`). Once a type has opted in, the hook decides its occurrences like any other type's (`AnEphemeralTypeThatKeepsItsBody_StillPassesThroughTheHookAsync`).
- **Every path recognizes the same types.** The outbox path reads the ephemeral flag the dispatcher stamped on the message; the event store decorator and the emitter derive it from the payload with the ephemeral resolver, which recognizes a type declared ephemeral through a base record or interface. Both are given the resolver when the container composes them (`ComposedDecoratorReceivesTheRegisteredEphemeralResolverAsync`, `AddWhizbang_TheDefaultEmitter_IsGivenTheEphemeralResolverAsync`). The decorator's resolver is a required constructor argument, with the default `EphemeralModeResolver` registered by `TryAdd`, so a decorator built by hand cannot silently miss a type declared `[Ephemeral]` (`Constructor_WithNullEphemeralResolver_ThrowsArgumentNullExceptionAsync`); an optional dependency would be null wherever the type is built by hand. An emitter built with its public constructor has no resolver and recognizes the `IEphemeralEvent` marker only (`EmitEventAuditedAsync_TheSameTypeWithoutAResolver_IsRecordedAsync`).
- **An unresolvable type** on the outbox path is audited as before unless the message is flagged ephemeral (`TryBuildAuditMessage_AnEphemeralEventOfAnUnresolvableType_IsNotAuditedAsync`).

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

## Rebuilding the audit ledger {#rebuilding-the-audit-ledger}

{verified: AuditLedgerRebuildTests.RunAsync_SelectsEveryStoredEvent_AndQueuesOnlyTheEligibleAsync, AuditLedgerRebuildTests.RunAsync_Twice_YieldsOneRecordPerOriginEventAsync, AuditLedgerRebuildTests.Rederive_ARecordTheLiveWriterMinted_IsTheSameRecordAsync, AuditRebuildRequestReceptorTests.Rebuild_FromTheStore_QueuesARecordForEachEligibleEventOnlyAsync, AuditRebuildRequestReceptorTests.Rebuild_Twice_YieldsOneRecordPerOriginEventAsync}

Audit records can be derived again from the events each service stored, so a lost, truncated or never-received audit ledger can be rebuilt. `RequestAuditRebuildCommand` (namespace `Whizbang.Core.Commands.System`) is a durable system command like `RebuildPerspectiveCommand`: dispatched in process it rebuilds that service's records, and sent it is broadcast so every service rebuilds the records of the events it stored:

```csharp{title="Rebuild one tenant's audit records" description="The origin re-derives the audit records of its stored events for one tenant, from a commit sequence on." framework="NET10" category="Best-Practices" difficulty="INTERMEDIATE" tags=["audit", "rebuild", "audit-ledger", "redelivery"] tests=["AuditRebuildRequestReceptorTests.Rebuild_FromTheStore_QueuesARecordForEachEligibleEventOnlyAsync", "AuditLedgerRebuildTests.RunAsync_PassesTheSelectionThroughAsync"]}
await dispatcher.SendAsync(new RequestAuditRebuildCommand {
  TenantScope = "tenant-a",        // optional: one tenant
  StreamIds = null,                // optional: named streams
  FromCommitSequence = 1_250_000,  // optional: exclusive floor
  ToCommitSequence = null,         // optional: inclusive ceiling
  MaxEvents = 5_000,               // optional: lowers the origin's cap, never raises it
});
```

The origin's built-in `AuditRebuildRequestReceptor` selects the stored events the way a [redelivery](../../resilience/stream-integrity.md) does, keeps the types audit eligibility admits, and queues each record to the outbox, from which it ships to the audit topic like any live audit record. It is registered at the same three stages as the redelivery receptor, so the command reaches it in process and over the inbox.

What a rebuild does, and why:

| Behavior | Why | Verified |
|---|---|---|
| Each record carries the id its live writer gave it, [`RecordIdFor(originalEventId)`](#record-ids). | The audit perspective keys a record by its id, so a rebuild, run once or many times, leaves one row per audited event. | {verified: AuditLedgerRebuildTests.Rederive_ARecordTheLiveWriterMinted_IsTheSameRecordAsync, AuditLedgerRebuildTests.RunAsync_Twice_YieldsOneRecordPerOriginEventAsync} |
| Only eligible types are re-derived: the mode, `[AuditEvent]`, the self-audit exclusion and the [ephemeral exclusion](#ephemeral-events) apply as on the live paths. | A rebuild must not mint records the live paths would never have written. | {verified: AuditLedgerRebuildTests.Rederive_AnExcludedType_IsNoRecordAsync, AuditLedgerRebuildTests.Rederive_OptIn_AnUnmarkedType_IsNoRecordAsync, AuditLedgerRebuildTests.Rederive_AStoredAuditRecord_IsNoRecordAsync, AuditLedgerRebuildTests.Rederive_AnEphemeralEvent_IsNoRecordAsync, AuditLedgerRebuildTests.Rederive_AnEphemeralEventThatKeepsItsBody_IsARecordWithItAsync} |
| The `IAuditDecisionHook` is not consulted. | A hook judges an event's payload, and a rebuild, like a redelivery, never rehydrates payloads (AOT metadata and upcast fidelity). An occurrence a hook vetoed live can therefore reappear in a rebuilt ledger. | {verified: AuditRebuildRequestReceptorTests.Rebuild_DoesNotConsultTheRegisteredDecisionHookAsync} |
| A stored type this build does not know is audited under `OptOut` and not under `OptIn`. | Under `OptOut` nothing could have excluded it; under `OptIn` nothing could have marked it. | {verified: AuditLedgerRebuildTests.Rederive_AnUnknownType_IsARecordUnderOptOutAsync, AuditLedgerRebuildTests.Rederive_AnUnknownType_IsNoRecordUnderOptInAsync, AuditLedgerRebuildTests.Rederive_AnUnknownEphemeralType_IsNoRecordAsync} |
| The record's time, correlation and causation come from the event's first stored hop; the rebuild's own time stands in only when the stored metadata has no hop to read. | An audit trail is read by when things happened; a rebuild must not move every record to the hour it ran. | {verified: AuditLedgerRebuildTests.Rederive_TheRecordTime_IsWhenTheEventHappenedNotWhenItWasRebuiltAsync, AuditLedgerRebuildTests.Rederive_CorrelationAndCausation_ComeFromTheStoredHopAsync, AuditLedgerRebuildTests.Rederive_NoStoredMetadata_StampsTheRebuildTimeAndNoChainAsync} |
| Tenant and user come from the stored scope; the record rides that tenant's ledger. A row with no scope is on the no-tenant ledger. | The same ledger rule as the live paths. | {verified: AuditLedgerRebuildTests.Rederive_AnEligibleEvent_IsARecordOfItOnTheTenantLedgerAsync, AuditLedgerRebuildTests.Rederive_NoStoredScope_IsOnTheNoTenantLedgerAsync} |
| The body is copied from the stored body only when the type or `AuditBodyDefault` keeps it. | The same body rule as the live paths. | {verified: AuditLedgerRebuildTests.Rederive_ByDefault_LeavesTheBodyOutAsync, AuditLedgerRebuildTests.Rederive_ATypeThatKeepsItsBody_CarriesTheStoredBodyAsync, AuditLedgerRebuildTests.Rederive_TheDefaultSetToInclude_CarriesEveryBodyAsync} |
| Selection is capped by `RedeliveryPumpOptions.MaxEventsPerRequest` and read in pages of `SelectPageSize`; `MaxEvents` can lower the cap, never raise it. | The origin owns its storm cap, as for a redelivery; a page bounds the memory one rebuild holds. Page through a larger history with `FromCommitSequence`. | {verified: AuditLedgerRebuildTests.RunAsync_StopsAtTheEventCapAsync, AuditLedgerRebuildTests.RunAsync_ARequestedCap_IsClampedByTheOriginsCapAsync, AuditLedgerRebuildTests.RunAsync_PagesWithTheKeysetOfTheLastEventAsync} |
| A service with event audit off selects nothing. | It writes no audit records, so it has no ledger to rebuild, and reading its store would be for nothing. | {verified: AuditLedgerRebuildTests.RunAsync_WithEventAuditOff_SelectsNothingAsync, AuditRebuildRequestReceptorTests.Rebuild_OnAServiceWithEventAuditOff_QueuesNothingAsync} |
| A host without a work coordinator or the deferred outbox channel logs the request and drops it. | A rebuild is an operator action; it must never fail the inbox message that carried it. | {verified: AuditRebuildRequestReceptorTests.Rebuild_WithoutTheCoordinatorOrTheChannel_DoesNothingAsync} |
| The command is control-plane traffic (no user security context; dropped rather than dead-lettered) but not in the supersedable `sys-control` class, and its own command audit keeps the number of streams it named, not the ids. | It is a framework request with no user behind it, but it is one-shot operator intent: the control class's short TTL would silently lose it, as it would a perspective rebuild. Its stream list is unbounded. | {verified: AuditLedgerRebuildTests.RequestAuditRebuildCommand_IsAuditedWithItsStreamCountAsync, ControlPlaneTypeRegistryTests.FrameworkControlPlaneTypes_AreRegisteredByDefaultAsync, SystemControlTagTests.DurableSystemCommands_DoNotCarryTheControlTagAsync} |

Reaped ephemeral events and at-most-once occurrences are never selected, as for any redelivery.

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

### Commands that carry id lists {#bounded-command-audit}

`CommandBody` is the command as serialized, except for lists a command declares as id lists of unbounded
length. A command implementing `IBoundedCommandAudit` names those properties in `ListsAuditedAsLengths()`,
and its audit record keeps each one's **length** (a JSON number) in place of the list. A null list stays
null, and every other property is kept as it is. Names are compared without regard to case, so a camel-case
naming policy does not matter.

The framework's own commands that carry stream lists use it: `RebuildPerspectiveCommand` (`IncludeStreamIds`,
`ExcludeStreamIds`) and `RequestRedeliveryCommand` (`StreamIds`). A rebuild of 100,000 streams is audited with
`"IncludeStreamIds": 100000`, not 4 MB of ids per receiving service.
{verified: CommandAuditListLengthsTests.ARebuildNamingStreams_IsAuditedWithTheListLengths_AndKeepsTheRestOfTheCommandAsync, CommandAuditListLengthsTests.ARedeliveryRequest_IsAuditedWithItsStreamCountAsync, CommandAuditListLengthsTests.ListLengths_MatchesNamesWithoutRegardToCase_AndKeepsANamedValueThatIsNotAListAsync}

```csharp{
title: "Auditing a command's id list by its length"
description: "A command that can name any number of customers declares that list, so its audit record keeps how many were named instead of every id."
framework: "NET10"
category: "Best-Practices"
difficulty: "INTERMEDIATE"
tags: ["audit", "command-audit", "id-lists", "message-size"]
tests: ["CommandAuditListLengthsTests.ARebuildNamingStreams_IsAuditedWithTheListLengths_AndKeepsTheRestOfTheCommandAsync"]
}
public sealed record NotifyCustomersCommand(Guid[] CustomerIds, string Template) : ICommand, IBoundedCommandAudit {
  private static readonly string[] _idLists = [nameof(CustomerIds)];

  public IReadOnlyCollection<string> ListsAuditedAsLengths() => _idLists;
}
```

### Enabling Command Auditing

```csharp{title="Enabling Command Auditing" description="Enabling Command Auditing" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Enabling", "Command"] tests=["CommandAuditTests.EnableEventAudit_OnlyEnablesEventAudit_Async", "CommandAuditTests.EnableCommandAudit_OnlyEnablesCommandAudit_Async", "CommandAuditTests.EnableAudit_EnablesBothEventAndCommandAudit_Async"]}
// AddSystemEventAuditing also registers the CommandAuditPipelineBehavior
// that emits CommandAudited for each command processed.
services.AddSystemEventAuditing(options => {
  options.EnableEventAudit();    // Events only
  options.EnableCommandAudit();  // Commands only
  options.EnableAudit();         // Both events and commands
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
  options.Tags.UseHook<AuditEventAttribute, AuditAlertHook>();
});
services.AddSystemEvents(options => options.EnableAudit());

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
services.AddSystemEvents(options => {
  options.EnableAudit();             // EventAudited + CommandAudited
  options.EnablePerspectiveEvents(); // Reserved (no events emitted yet)
  options.EnableErrorEvents();       // Reserved (no events emitted yet)
  options.EnableAll();               // All of the above
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
