---
title: Message Tags
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Core Concepts
order: 10
description: >-
  Declarative cross-cutting concerns via message tag attributes and hooks -
  notifications, telemetry, metrics, and audit logging without polluting business logic
tags: 'tags, attributes, hooks, notifications, telemetry, metrics, cross-cutting'
codeReferences:
  - src/Whizbang.Core/Tags/MessageTagProcessor.cs
  - src/Whizbang.Core/Tags/IMessageTagProcessor.cs
  - src/Whizbang.Core/Tags/MessageTagRegistry.cs
  - src/Whizbang.Core/Tags/IMessageTagRegistry.cs
  - src/Whizbang.Core/Tags/MessageTagRegistration.cs
  - src/Whizbang.Core/Tags/TagOptions.cs
  - src/Whizbang.Core/Tags/TagHookRegistration.cs
  - src/Whizbang.Core/Tags/TagContext.cs
  - src/Whizbang.Core/Tags/IMessageTagHook.cs
  - src/Whizbang.Core/Tags/IMessageTagHookDispatcher.cs
  - src/Whizbang.Core/Tags/MessageTagHookDispatcherRegistry.cs
  - src/Whizbang.Core/Tags/SignalPriority.cs
  - src/Whizbang.Core/Tags/SpanKind.cs
  - src/Whizbang.Core/Tags/MetricType.cs
  - src/Whizbang.Core/Attributes/MessageTagAttribute.cs
  - src/Whizbang.Core/Attributes/SignalTagAttribute.cs
  - src/Whizbang.Core/Attributes/TelemetryTagAttribute.cs
  - src/Whizbang.Core/Attributes/MetricTagAttribute.cs
  - src/Whizbang.Core/Attributes/AuditEventAttribute.cs
  - src/Whizbang.Core/Attributes/AttributeArgNamingAttribute.cs
  - src/Whizbang.Core/Attributes/AttributeArgNamingConvention.cs
  - src/Whizbang.Core/Audit/AuditLevel.cs
  - src/Whizbang.Core/Configuration/WhizbangCoreOptions.cs
  - src/Whizbang.Core/Messaging/LifecycleStage.cs
  - src/Whizbang.Core/Security/IScopeContext.cs
  - src/Whizbang.Core/Security/ScopeContextAccessor.cs
  - src/Whizbang.Generators/MessageTagDiscoveryGenerator.cs
  - src/Whizbang.Generators/Utilities/AttributeArgNamingHelper.cs
testReferences:
  - tests/Whizbang.Core.Tests/Tags/TagOptionsTests.cs
  - tests/Whizbang.Core.Tests/Tags/TagContextTests.cs
  - tests/Whizbang.Core.Tests/Tags/MessageTagProcessorTests.cs
  - tests/Whizbang.Core.Tests/Tags/MessageTagHookTests.cs
  - tests/Whizbang.Core.Tests/Tags/TagHookRegistrationTests.cs
  - tests/Whizbang.Core.Tests/Tags/TagHookStageFilteringAndScopeTests.cs
  - tests/Whizbang.Core.Tests/Tags/DispatcherTagProcessingTests.cs
  - tests/Whizbang.Core.Tests/Tags/MessageTagDiscoveryGeneratorTests.cs
  - tests/Whizbang.Core.Tests/Tags/SignalTagAttributeTests.cs
  - tests/Whizbang.Core.Tests/Tags/SignalPriorityTests.cs
  - tests/Whizbang.Core.Tests/Tags/TelemetryTagAttributeTests.cs
  - tests/Whizbang.Core.Tests/Tags/MetricTagAttributeTests.cs
  - tests/Whizbang.Core.Tests/Tags/MetricTypeTests.cs
  - tests/Whizbang.Core.Tests/Tags/SpanKindTests.cs
  - tests/Whizbang.Core.Tests/Attributes/AttributeArgNamingAttributeTests.cs
  - tests/Whizbang.Core.Tests/Audit/AuditEventAttributeTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditEventAttributeExcludeTests.cs
  - tests/Whizbang.Generators.Tests/AttributeArgNamingHelperTests.cs
  - tests/Whizbang.Generators.Tests/MessageTagDiscoveryGeneratorTests.cs
---

# Message Tags

Message tags enable **declarative cross-cutting concerns** - attach attributes to messages and hooks execute automatically when those messages are processed. Build notifications, telemetry, metrics, and audit logs without polluting business logic.

> **Naming note.** The framework's built-in real-time notification tag is **`SignalTagAttribute`** (with **`SignalPriority`**), *not* `NotificationTagAttribute`. `[NotificationTag]` is a JDNext-application attribute that layers on top of this system; the Whizbang core type is `SignalTagAttribute`. Earlier drafts of this page used the JDNext name — the examples below use the real core type.

## Core Concept

```mermaid{title="Message tag processing at a glance" description="A tagged message flows through its receptor and cascade events, then tag processing fans out to every registered hook." caption="Message tag processing flow — a tagged message runs through its receptor and cascade events, then tag processing fans out to every registered hook." tests=["MessageTagProcessorTests.ProcessTagsAsync_WithMatchingTag_InvokesHookAsync", "MessageTagProcessorTests.ProcessTagsAsync_InvokesHooksInPriorityOrderAsync"]}
graph LR
    A[Tagged Message] --> B[Receptor]
    B --> C[Cascade Events]
    C --> D[Tag Processing]
    D --> E[Hook 1]
    D --> F[Hook 2]
    D --> G[Hook N]

    style A fill:#e1f5ff
    style D fill:#d4edda
    style E fill:#fff3cd
    style F fill:#fff3cd
    style G fill:#fff3cd
```

**Tag Processing Flow**:
1. Message is dispatched and processed by receptor
2. After receptor completion, `MessageTagProcessor` checks for tag attributes
3. Registered hooks execute in priority order
4. Each hook receives the message, attribute, and extracted payload

## What Are Message Tags?

Message tags provide a **declarative way** to apply cross-cutting concerns to messages without coupling your business logic to infrastructure concerns like notifications, tracing, or metrics.

**Key Benefits**:
- **Separation of Concerns**: Business logic stays focused on domain behavior
- **Compile-Time Discovery**: Source generator discovers tags at build time (zero reflection)
- **Type-Safe**: Full IntelliSense support and compile-time checking
- **Extensible**: Create custom tag attributes for your domain needs
- **AOT Compatible**: No runtime reflection or dynamic code generation

### How It Works

```csharp{title="Tag Processing Pipeline" description="Understanding the message tag processing flow from decoration to hook invocation" category="Messaging" difficulty="INTERMEDIATE" tags=["Tags", "Architecture", "Pipeline"] tests=["MessageTagProcessorTests.ProcessTagsAsync_WithMatchingTag_InvokesHookAsync", "MessageTagProcessorTests.ProcessTagsAsync_InvokesHooksInPriorityOrderAsync"]}
// 1. Decorate messages with tag attributes
[SignalTag(Tag = "order-created", Properties = ["OrderId", "CustomerId"])]
[TelemetryTag(Tag = "order-telemetry", SpanName = "CreateOrder")]
public record OrderCreatedEvent(Guid OrderId, Guid CustomerId, decimal Total) : IEvent;

// 2. Message flows through dispatcher
dispatcher.Dispatch(new OrderCreatedEvent(...));
  // → Receptor executes
  // → Cascade events (if any)
  // → ProcessTagsAsync() called
  //   → MessageTagRegistry.GetTagsFor(typeof(OrderCreatedEvent))
  //   → For each registration:
  //     → Build payload from Properties/ExtraJson
  //     → Invoke matching hooks in priority order

// 3. Hooks process the tagged message
public class SignalRNotificationHook : IMessageTagHook<SignalTagAttribute> {
  public async ValueTask<JsonElement?> OnTaggedMessageAsync(
      TagContext<SignalTagAttribute> context,
      CancellationToken ct) {
    // Send notification using context.Payload
    return null;
  }
}
```

## Quick Start

### 1. Configure Tag Hooks {#configuration} {#hook-registration}

Register hooks in your `Program.cs` or `Startup.cs`:

```csharp{title="Configuring Tag Hooks" description="Register hooks for built-in and custom tag attributes inside AddWhizbang" category="Configuration" difficulty="BEGINNER" tags=["Tags", "Configuration", "Hooks"] tests=["TagOptionsTests.UseHook_AllowsMultipleAttributeTypesAsync", "TagOptionsTests.UseUniversalHook_RegistersForMessageTagAttributeAsync"]}
services.AddWhizbang(options => {
  // Register hooks for built-in tag types
  options.Tags.UseHook<SignalTagAttribute, SignalRNotificationHook>();
  options.Tags.UseHook<TelemetryTagAttribute, OpenTelemetrySpanHook>();
  options.Tags.UseHook<MetricTagAttribute, MetricsPublishHook>();

  // Register hooks for custom / audit tag attributes
  options.Tags.UseHook<AuditEventAttribute, AuditLogHook>();

  // Optional: Universal hook for ALL tagged messages
  options.Tags.UseUniversalHook<UniversalTagLoggerHook>();
});
```

**Priority Control**: Hooks execute in ascending priority order (lower values first). The **default priority is `-100`** (lowest — fires first), not `0`:

```csharp{title="Hook Priority Configuration" description="Control hook execution order with explicit priority values" category="Configuration" difficulty="INTERMEDIATE" tags=["Tags", "Hooks", "Priority"] tests=["TagOptionsTests.UseHook_UsesDefaultPriorityAsync", "TagOptionsTests.UseHook_AcceptsCustomPriorityAsync", "TagOptionsTests.GetHooksInExecutionOrder_SortsByPriorityAscendingAsync"]}
options.Tags.UseHook<SignalTagAttribute, ValidationHook>(priority: -100);  // First (also the default)
options.Tags.UseHook<SignalTagAttribute, NotificationHook>(priority: 0);   // Middle
options.Tags.UseHook<SignalTagAttribute, AuditHook>(priority: 500);        // Last
```

> Verified: `TagOptions.UseHook<TAttribute, THook>(int priority = -100, LifecycleStage? fireAt = null)` — `tests/Whizbang.Core.Tests/Tags/TagOptionsTests.cs` (`UseHook_UsesDefaultPriorityAsync` asserts the default is `-100`; `GetHooksInExecutionOrder_SortsByPriorityAscendingAsync` locks in ascending ordering).

### 2. Tag Your Messages

Apply tag attributes to events and commands:

```csharp{title="Tagging Messages" description="Apply signal, telemetry, and metric tag attributes to events" category="Attributes" difficulty="BEGINNER" tags=["Tags", "Events", "Attributes"] tests=["SignalTagAttributeTests.SignalTagAttribute_CanBeAppliedToEventAsync", "TelemetryTagAttributeTests.TelemetryTagAttribute_CanBeAppliedToEventAsync", "MetricTagAttributeTests.MetricTagAttribute_Counter_CanBeAppliedToEventAsync"]}
// Signal tag - for real-time notifications
[SignalTag(
    Tag = "order-created",
    Properties = ["OrderId", "CustomerId"],
    Group = "customer-{CustomerId}",
    Priority = SignalPriority.Normal)]
public record OrderCreatedEvent(Guid OrderId, Guid CustomerId, decimal Total) : IEvent;

// Telemetry tag - for distributed tracing
[TelemetryTag(
    Tag = "payment-processed",
    SpanName = "ProcessPayment",
    Kind = SpanKind.Internal,
    RecordAsEvent = true)]
public record PaymentProcessedEvent(Guid PaymentId, decimal Amount) : IEvent;

// Metric tag - for counters/gauges
[MetricTag(
    Tag = "orders-metric",
    MetricName = "orders.created",
    Type = MetricType.Counter,
    Properties = ["TenantId", "Region"])]
public record OrderCountEvent(Guid OrderId, string TenantId, string Region) : IEvent;

// Multiple tags on one message
[SignalTag(Tag = "payment-completed", Properties = ["PaymentId", "Amount"])]
[TelemetryTag(Tag = "payment-trace", SpanName = "CompletePayment")]
[MetricTag(Tag = "payment-amount", MetricName = "payments.total", Type = MetricType.Histogram, ValueProperty = "Amount")]
public record PaymentCompletedEvent(Guid PaymentId, decimal Amount) : IEvent;
```

### 3. Implement a Hook {#hooks}

Create hooks that respond to tagged messages. Hooks are resolved from a **fresh DI scope per dispatch**, so scoped services (e.g. `DbContext`) work:

```csharp{title="Implementing a Tag Hook" description="Create a hook that resolves the group template and sends a SignalR notification" category="Messaging" difficulty="INTERMEDIATE" tags=["Tags", "Hooks", "SignalR"] tests=["MessageTagHookTests.Hook_CanAccessAttributePropertiesAsync", "MessageTagHookTests.Hook_CanAccessScopeDataAsync"]}
public class SignalRNotificationHook : IMessageTagHook<SignalTagAttribute> {
  private readonly IHubContext<NotificationHub> _hubContext;
  private readonly MyDbContext _dbContext; // Scoped services work!

  public SignalRNotificationHook(
      IHubContext<NotificationHub> hubContext,
      MyDbContext dbContext) {
    _hubContext = hubContext;
    _dbContext = dbContext;
  }

  public async ValueTask<JsonElement?> OnTaggedMessageAsync(
      TagContext<SignalTagAttribute> context,
      CancellationToken ct) {

    // Access the tag identifier
    var tag = context.Attribute.Tag;  // e.g., "order-created"

    // Access signal-specific properties
    var group = context.Attribute.Group;      // e.g., "customer-{CustomerId}"
    var priority = context.Attribute.Priority; // SignalPriority.High

    // Resolve group template placeholders
    var resolvedGroup = _resolveGroupTemplate(group, context.Payload);

    // Access the payload (JSON with extracted properties)
    var payload = context.Payload;
    var orderId = payload.GetProperty("OrderId").GetGuid();

    // Access scope data (tenant, user, roles, permissions)
    var tenantId = context.Scope?.Scope?.TenantId;

    // Send notification via SignalR
    await _hubContext.Clients.Group(resolvedGroup).SendAsync(
        "Notification",
        new { Tag = tag, Data = payload, Priority = priority },
        ct);

    // Return null to keep original payload
    // Or return modified JsonElement for subsequent hooks
    return null;
  }

  private string _resolveGroupTemplate(string? template, JsonElement payload) {
    if (template is null) return "all";

    // Replace {PropertyName} placeholders with values from payload
    var resolved = template;
    foreach (var prop in payload.EnumerateObject()) {
      resolved = resolved.Replace($"{{{prop.Name}}}", prop.Value.ToString());
    }
    return resolved;
  }
}
```

## Tag Processing Pipeline {#processing}

The `MessageTagProcessor` orchestrates tag hook execution after successful receptor completion. It is registered as a **singleton** and creates a fresh DI scope for each processing call.

### Processing Flow

```mermaid{title="Tag hook execution sequence" description="After the receptor returns and cascade events run, the dispatcher calls ProcessTagsAsync, which queries the registry and invokes hooks in priority order." caption="Tag hook execution sequence — after the receptor returns and cascade events run, ProcessTagsAsync queries the registry, builds the payload, and invokes hooks in ascending priority order." tests=["MessageTagProcessorTests.ProcessTagsAsync_InvokesHooksInPriorityOrderAsync", "MessageTagProcessorTests.ProcessTagsAsync_BuildsPayloadFromMessageAsync"]}
sequenceDiagram
    participant D as Dispatcher
    participant R as Receptor
    participant P as MessageTagProcessor
    participant Reg as MessageTagRegistry
    participant H1 as Hook (Priority -100)
    participant H2 as Hook (Priority 0)

    D->>R: Invoke receptor
    R-->>D: Return result
    D->>D: Cascade events
    D->>P: ProcessTagsAsync(message, type, AfterReceptorCompletion, scope)
    P->>Reg: GetTagsFor(messageType)
    Reg-->>P: [MessageTagRegistration]
    P->>P: Build payload from registration
    P->>H1: OnTaggedMessageAsync(context, ct)
    H1-->>P: Modified payload or null
    P->>H2: OnTaggedMessageAsync(context, ct)
    H2-->>P: null
```

`ProcessTagsAsync` is invoked with the message, its type, a `LifecycleStage`, and the optional `IScopeContext`. It is called from multiple callers (Dispatcher, workers) at different stages — see [Stage-Based Filtering](#lifecycle-stage).

### Processing Modes

#### AfterReceptorCompletion (Default)

Tags are processed immediately after receptor completion:

```
Message → Receptor → Cascade Events → TAG PROCESSING → Lifecycle Stages
```

This is the most common mode and ensures tags are processed as soon as the message handler completes. In this mode the dispatcher calls `ProcessTagsAsync(..., LifecycleStage.AfterReceptorCompletion, ...)`.

#### AsLifecycleStage

Tags are processed during lifecycle invocation (use when hooks depend on lifecycle receptors):

```
Message → Receptor → Cascade Events → Lifecycle Stages → TAG PROCESSING
```

```csharp{title="Lifecycle Stage Mode" description="Switch tag processing to run during the lifecycle stages instead of immediately" category="Configuration" difficulty="INTERMEDIATE" tags=["Tags", "Configuration", "Lifecycle"] unverified="configuration toggle — WhizbangCoreOptions.TagProcessingMode enum and default verified in source, no runtime test"}
services.AddWhizbang(options => {
  options.TagProcessingMode = TagProcessingMode.AsLifecycleStage;
});
```

> Verified: `WhizbangCoreOptions.TagProcessingMode` defaults to `TagProcessingMode.AfterReceptorCompletion`; `TagProcessingMode` has exactly two members: `AfterReceptorCompletion`, `AsLifecycleStage` — `src/Whizbang.Core/Configuration/WhizbangCoreOptions.cs`.

### When Tag Processing Is Skipped

At the `AfterReceptorCompletion` call site, tag processing is skipped when:
- `EnableTagProcessing` is set to `false` (default is `true`)
- `TagProcessingMode` is not `AfterReceptorCompletion` (i.e. tags are processed later, during the lifecycle)
- No hook resolver / scope factory is configured
- No tags are registered for the message type

## Tag Context {#tag-context}

The `TagContext<TAttribute>` (a `sealed record`) provides hooks with all necessary data for processing tagged messages:

| Property | Type | Description |
|----------|------|-------------|
| `Attribute` | `TAttribute` | The tag attribute instance with configured values (Tag, Properties, etc.) |
| `AttributeType` | `Type` | The attribute type (`typeof(TAttribute)`) for generic handling |
| `Message` | `object` | The original message object |
| `MessageType` | `Type` | The message's runtime type |
| `Payload` | `JsonElement` | JSON payload with extracted properties and merged extra JSON |
| `Scope` | `IScopeContext?` | Security scope context (tenant, user, roles, permissions) from the message envelope |
| `Stage` | `LifecycleStage` | The lifecycle stage at which this hook is being invoked |

### Reading Scope Data

`Scope` is an `IScopeContext` — there is **no string indexer**. Read tenant/user via the nested `PerspectiveScope`, and roles/permissions via the helper methods:

```csharp{title="Accessing scope in a hook" description="IScopeContext exposes typed accessors (nested PerspectiveScope, HasRole, HasPermission), not an indexer" category="Identity" difficulty="INTERMEDIATE" tags=["Tags", "Security", "Scope"] tests=["MessageTagHookTests.Hook_CanAccessScopeDataAsync"]}
var tenantId = context.Scope?.Scope?.TenantId;
var userId   = context.Scope?.Scope?.UserId;
var isAdmin  = context.Scope?.HasRole("Admin") ?? false;
var canRead  = context.Scope?.HasPermission(Permission.Read("orders")) ?? false;
```

### Lifecycle Stage {#lifecycle-stage}

The `Stage` property tells hooks **when** in the message lifecycle they are being called. There are **two ways** to control when a hook runs:

1. **Server-side (registration-time) filtering** — pass `fireAt:` when registering. The framework only invokes the hook at that stage (via `TagOptions.GetHooksFor(attributeType, stage)`). This is the mechanism JDNext uses.
2. **In-hook filtering** — omit `fireAt` (the default `null` means "fire at every stage") and inspect `context.Stage` inside the hook.

```csharp{title="Server-side stage filtering with fireAt" description="Register a hook to fire only at one lifecycle stage — the framework filters, not the hook" category="Configuration" difficulty="INTERMEDIATE" tags=["Tags", "LifecycleStage", "Hooks"] tests=["TagOptionsTests.UseHook_AcceptsCustomFireAtAsync", "TagOptionsTests.GetHooksFor_WithStage_ExcludesHooksForOtherStagesAsync"]}
// Only invoke this hook at PostAllPerspectivesDetached — the framework filters, not the hook.
options.Tags.UseHook<SignalTagAttribute, SignalRNotificationHook>(
    fireAt: LifecycleStage.PostAllPerspectivesDetached);
```

```csharp{title="In-hook stage filtering with context.Stage" description="A hook registered at every stage that only acts once, after the perspective checkpoint commits" category="Messaging" difficulty="INTERMEDIATE" tags=["Tags", "LifecycleStage", "Hooks"] tests=["MessageTagProcessorTests.ProcessTagsAsync_HookCanFilterByStage_OnlyActsOnPostPerspectiveDetachedAsync", "MessageTagProcessorTests.ProcessTagsAsync_PassesStageToHookContext_AllStagesAsync"]}
public class SignalRNotificationHook : IMessageTagHook<SignalTagAttribute> {
  private readonly IHubContext<NotificationHub> _hubContext;

  public SignalRNotificationHook(IHubContext<NotificationHub> hubContext) {
    _hubContext = hubContext;
  }

  public async ValueTask<JsonElement?> OnTaggedMessageAsync(
      TagContext<SignalTagAttribute> context, CancellationToken ct) {
    // Fired at every stage (no fireAt) — act only once, after the perspective checkpoint.
    if (context.Stage != LifecycleStage.PostPerspectiveInline)
      return null;

    await _hubContext.Clients.All.SendAsync(
        "Notification",
        new { Tag = context.Attribute.Tag, Data = context.Payload },
        ct);

    return null;
  }
}
```

:::tip
`LifecycleStage` has **25 members**: 24 real lifecycle stages plus the special value `AfterReceptorCompletion = -1`, which fires synchronously after the receptor completes, *before* any real lifecycle stage is invoked. `AfterReceptorCompletion` is not a true lifecycle stage — it is the tag system's default firing point.
:::

> Verified: `src/Whizbang.Core/Messaging/LifecycleStage.cs` — 24 stages + `AfterReceptorCompletion = -1`; the enum's own summary reads "Defines the 24 lifecycle stages". `fireAt` server-side filtering is exercised by `tests/Whizbang.Core.Tests/Tags/TagHookStageFilteringAndScopeTests.cs` (a hook registered at `PostAllPerspectivesDetached` does not fire at `AfterReceptorCompletion`, and does fire at its registered stage).

### Payload Structure

The payload is a flat JSON object built from two sources:

1. **Extracted Properties**: Fields listed in the `Properties` array
2. **Extra JSON**: Merged content from the `ExtraJson` property

`Properties` controls what lands in the payload:

- **Explicit array** like `["OrderId", "CustomerId"]` — only those fields are extracted.
- **Explicit empty array** `[]` — no fields are extracted; the tag fires with just a tag name and any `ExtraJson`. Use this when the tag itself (not its data) is the signal.
- **Omitted** (`null`) — the generator falls back to every public property on the event type. Preserved for backward compat; **not recommended** for high-volume signal payloads because they travel over real-time transports and oversized payloads are easy to create by accident. (The built-in `AuditEventAttribute` deliberately leaves `Properties` null — audit needs the full event body.)

```csharp{title="Understanding Payload Structure" description="How the flat tag payload is assembled from extracted properties plus merged ExtraJson" category="Messaging" difficulty="INTERMEDIATE" tags=["Tags", "Payload", "JSON"] tests=["MessageTagDiscoveryGeneratorTests.Generator_WithExplicitProperties_EmitsOnlyDeclaredFieldsAsync", "MessageTagDiscoveryGeneratorTests.Generator_WithExtraJson_GeneratesMergeCodeAsync"]}
[SignalTag(
    Tag = "order-created",
    Properties = ["OrderId", "CustomerId"],
    ExtraJson = """{"source": "api", "version": 2}""")]
public record OrderCreatedEvent(Guid OrderId, Guid CustomerId, decimal Total, string InternalNote);

// When dispatched: new OrderCreatedEvent(TrackedGuid.NewMedo(), TrackedGuid.NewMedo(), 99.99m, "Internal note")
// Payload structure:
// {
//   "OrderId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
//   "CustomerId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
//   "source": "api",
//   "version": 2
// }
```

### Accessing Payload Data

```csharp{title="Working with Payload Data" description="Reading extracted properties, merged ExtraJson, and un-extracted fields from a tag context" category="Messaging" difficulty="BEGINNER" tags=["Tags", "Payload", "JSON"] tests=["MessageTagProcessorTests.ProcessTagsAsync_BuildsPayloadFromMessageAsync", "MessageTagHookTests.Hook_CanAccessMessageAndMessageTypeAsync"]}
public async ValueTask<JsonElement?> OnTaggedMessageAsync(
    TagContext<SignalTagAttribute> context,
    CancellationToken ct) {

  var payload = context.Payload;

  // Access extracted properties
  var orderId = payload.GetProperty("OrderId").GetGuid();
  var customerId = payload.GetProperty("CustomerId").GetGuid();

  // Access extra JSON (merged into the same flat object)
  if (payload.TryGetProperty("source", out var source)) {
    var sourceValue = source.GetString(); // "api"
  }

  // Need a field that wasn't in Properties? Read it from the strongly-typed
  // Message instead — the full event is on TagContext.Message.
  if (context.Message is OrderCreatedEvent evt) {
    var total = evt.Total;
  }

  return null;
}
```

### Payload Size Thresholds

The processor measures each built payload and flags oversized ones via `TagOptions`:

| Option | Default | Behavior |
|--------|---------|----------|
| `PayloadSizeWarningThresholdBytes` | `8192` | Logs a warning with message type, tag, and size. Set to `null` to disable. |
| `PayloadSizeErrorThresholdBytes` | `null` (disabled) | Throws `InvalidOperationException` *before any hook runs* for that tag. |

```csharp{title="Configuring payload size thresholds" description="Catch runaway tag payloads with warning and error byte thresholds before they ship" category="Configuration" difficulty="BEGINNER" tags=["Tags", "Configuration", "Payload"] tests=["MessageTagProcessorTests.ProcessTagsAsync_PayloadExceedsWarningThreshold_LogsWarningAsync", "MessageTagProcessorTests.ProcessTagsAsync_PayloadExceedsErrorThreshold_ThrowsAsync"]}
services.AddWhizbang(options => {
  options.Tags.PayloadSizeWarningThresholdBytes = 4096;
  options.Tags.PayloadSizeErrorThresholdBytes = 65_536;
});
```

Typical root cause when this fires: a tag attribute omitted `Properties`, so the generator extracted every public property on the event — including fields the hook does not need.

> Verified: `src/Whizbang.Core/Tags/TagOptions.cs` (defaults `PayloadSizeWarningThresholdBytes = 8192`, `PayloadSizeErrorThresholdBytes = null`) and `src/Whizbang.Core/Tags/MessageTagProcessor.cs` (`_enforcePayloadSize` logs at the warning threshold and throws `InvalidOperationException` before dispatching hooks when over the error threshold).

## Built-in Tag Attributes {#built-in-tags}

Whizbang ships **four** tag attributes. Three of them — `SignalTagAttribute`, `TelemetryTagAttribute`, `MetricTagAttribute` — have hardcoded fast paths in `MessageTagProcessor`. The fourth, `AuditEventAttribute`, is routed through the same generated dispatcher used for user-defined custom attributes.

| Attribute | Purpose | Key Properties |
|-----------|---------|----------------|
| `SignalTagAttribute` | Real-time notifications (SignalR/WebSockets) | `Tag`, `Properties`, `Group`, `Priority` |
| `TelemetryTagAttribute` | Distributed tracing | `Tag`, `SpanName`, `Kind`, `RecordAsEvent` |
| `MetricTagAttribute` | Metrics/counters | `Tag`, `MetricName`, `Type`, `ValueProperty`, `Unit` |
| `AuditEventAttribute` | Selective audit logging | `Tag` (default `"audit"`), `Reason`, `Level`, `Exclude` |

All tag attributes inherit from `MessageTagAttribute` and share these base properties:

| Property | Type | Description |
|----------|------|-------------|
| `Tag` | `string` (required) | Unique identifier for this tag |
| `Properties` | `string[]?` | Property names to extract into payload. `null` = every public property (backward-compat fallback), `[]` = no fields extracted |
| `ExtraJson` | `string?` | Additional JSON to merge into payload (supports `{PropertyName}` template expansion) |

`MessageTagAttribute` carries `[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, AllowMultiple = true, Inherited = true)]`.

### SignalTagAttribute {#signal-tag}

Tags messages for real-time notification delivery through SignalR, WebSockets, or other push mechanisms. The built-in `SignalRNotificationHook` (in `Whizbang.SignalR`) sends the payload to the resolved group.

```csharp{title="SignalTag Properties" description="Full property reference for SignalTagAttribute, including group placeholders and priority" category="Attributes" difficulty="BEGINNER" tags=["Tags", "Notifications", "API"] tests=["SignalTagAttributeTests.SignalTagAttribute_CanBeAppliedToEventAsync", "SignalTagAttributeTests.SignalTagAttribute_Group_CanBeSetAsync", "SignalTagAttributeTests.SignalTagAttribute_Priority_CanBeSetToHighAsync"]}
[SignalTag(
    Tag = "order-shipped",              // Unique identifier for this notification type
    Properties = ["OrderId", "TrackingNumber"],  // Properties to extract into payload
    Group = "customer-{CustomerId}",    // Target group with {PropertyName} placeholders
    Priority = SignalPriority.High,     // Delivery priority
    ExtraJson = """{"category": "shipping"}"""  // Extra metadata
)]
public record OrderShippedEvent(
    Guid OrderId,
    Guid CustomerId,
    string TrackingNumber,
    DateTime ShippedAt);
```

**Properties**:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Tag` | `string` | (required) | Unique identifier for the notification |
| `Group` | `string?` | `null` | Target group/channel, supports `{PropertyName}` placeholders |
| `Priority` | `SignalPriority` | `Normal` | Notification priority level |
| `Properties` | `string[]?` | `null` | Properties to extract from message (see Payload Structure for null vs `[]` semantics) |
| `ExtraJson` | `string?` | `null` | Additional JSON to merge |

**Group Templates**:

The `Group` property supports dynamic resolution using property placeholders:

```csharp{title="Dynamic Group Resolution" description="Using {PropertyName} placeholders to target customers, tenants, users, or broadcast" category="Attributes" difficulty="INTERMEDIATE" tags=["Tags", "Notifications", "Groups"] tests=["SignalTagAttributeTests.SignalTagAttribute_Group_CanBeSetAsync"]}
[SignalTag(Tag = "order-update", Group = "customer-{CustomerId}")]   // Specific customer
[SignalTag(Tag = "user-action", Group = "tenant-{TenantId}")]       // Specific tenant
[SignalTag(Tag = "direct-message", Group = "user-{UserId}")]        // Specific user
[SignalTag(Tag = "system-alert", Group = "all")]                    // Broadcast to all
[SignalTag(Tag = "order-event", Group = "tenant-{TenantId}-orders")] // Multiple segments
```

#### SignalPriority {#signal-priority}

The `SignalPriority` enum controls notification delivery urgency:

| Value | Numeric | Description | Use Cases |
|-------|---------|-------------|-----------|
| `Low` | 0 | Background notifications, may be batched | Informational updates, digest emails |
| `Normal` | 1 | Standard priority (default) | Regular notifications, status updates |
| `High` | 2 | Immediate delivery, prominent display | Order confirmations, important updates |
| `Critical` | 3 | Urgent system alerts, bypass user preferences | System failures, security alerts |

> Verified: `src/Whizbang.Core/Tags/SignalPriority.cs` (`Low = 0`, `Normal = 1`, `High = 2`, `Critical = 3`); `tests/Whizbang.Core.Tests/Tags/SignalTagAttributeTests.cs` (`SignalTagAttribute_Priority_DefaultsToNormalAsync`, `SignalTagAttribute_Group_IsNullByDefaultAsync`).

### TelemetryTagAttribute {#telemetry-tag}

Tags messages for OpenTelemetry distributed tracing integration. The built-in `OpenTelemetrySpanHook` (in `Whizbang.Observability`) creates or enriches spans.

```csharp{title="TelemetryTag Properties" description="Full property reference for TelemetryTagAttribute, including span name, kind, and event recording" category="Attributes" difficulty="BEGINNER" tags=["Tags", "Telemetry", "API"] tests=["TelemetryTagAttributeTests.TelemetryTagAttribute_CanBeAppliedToEventAsync", "TelemetryTagAttributeTests.TelemetryTagAttribute_SpanName_CanBeSetAsync", "TelemetryTagAttributeTests.TelemetryTagAttribute_Kind_DefaultsToInternalAsync"]}
[TelemetryTag(
    Tag = "payment-processed",          // Unique identifier
    SpanName = "ProcessPayment",        // OpenTelemetry span name
    Kind = SpanKind.Internal,           // Span kind (Internal, Server, Client, Producer, Consumer)
    RecordAsEvent = true,               // Record as span event (default)
    Properties = ["PaymentId", "Amount"] // Properties to include as span attributes
)]
public record PaymentProcessedEvent(Guid PaymentId, decimal Amount, string Currency);
```

**Properties**:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Tag` | `string` | (required) | Unique identifier for the telemetry tag |
| `SpanName` | `string?` | `Tag` value | OpenTelemetry span name (defaults to Tag if not specified) |
| `Kind` | `SpanKind` | `Internal` | Span kind for distributed tracing |
| `RecordAsEvent` | `bool` | `true` | Record message as span event with properties |
| `Properties` | `string[]?` | `null` | Properties to include as span attributes |
| `ExtraJson` | `string?` | `null` | Additional metadata |

#### SpanKind {#span-kind}

| Value | Numeric | Description | Use Cases |
|-------|---------|-------------|-----------|
| `Internal` | 0 | Internal operation (default) | Local calls, database queries, business logic |
| `Server` | 1 | Server-side request handling | HTTP endpoints, gRPC handlers |
| `Client` | 2 | Client-side outgoing request | HTTP client calls, DB client queries |
| `Producer` | 3 | Message publishing | Publishing to broker / event bus |
| `Consumer` | 4 | Message consumption | Consuming from a queue, processing events |

> Verified: `src/Whizbang.Core/Tags/SpanKind.cs`, `src/Whizbang.Core/Attributes/TelemetryTagAttribute.cs`.

### MetricTagAttribute {#metric-tag}

Tags messages for OpenTelemetry metrics recording. The built-in `OpenTelemetryMetricHook` (in `Whizbang.Observability`) records the metric.

```csharp{title="MetricTag Properties" description="Counter, histogram, and gauge examples showing when ValueProperty is required" category="Attributes" difficulty="BEGINNER" tags=["Tags", "Metrics", "API"] tests=["MetricTagAttributeTests.MetricTagAttribute_Counter_CanBeAppliedToEventAsync", "MetricTagAttributeTests.MetricTagAttribute_Histogram_CanBeAppliedToEventAsync", "MetricTagAttributeTests.MetricTagAttribute_Type_CanBeSetToGaugeAsync", "MetricTagAttributeTests.MetricTagAttribute_ValueProperty_CanBeSetAsync"]}
// Counter metric - counts occurrences (increments by 1)
[MetricTag(
    Tag = "order-created",
    MetricName = "orders.created",      // Metric name following OpenTelemetry conventions
    Type = MetricType.Counter,          // Counter type (default)
    Properties = ["TenantId", "Region"], // Dimensions/labels for segmentation
    Unit = "count")]
public record OrderCreatedEvent(Guid OrderId, string TenantId, string Region);

// Histogram metric - records value distribution
[MetricTag(
    Tag = "order-amount",
    MetricName = "orders.amount",
    Type = MetricType.Histogram,
    ValueProperty = "TotalAmount",      // Property to use as metric value (required)
    Properties = ["TenantId"],
    Unit = "USD")]
public record OrderCompletedEvent(Guid OrderId, decimal TotalAmount, string TenantId);

// Gauge metric - point-in-time value
[MetricTag(
    Tag = "queue-depth",
    MetricName = "orders.queue.depth",
    Type = MetricType.Gauge,
    ValueProperty = "QueueDepth",       // Required
    Unit = "items")]
public record OrderQueueDepthEvent(int QueueDepth, string QueueName);
```

**Properties**:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Tag` | `string` | (required) | Unique identifier for the metric tag |
| `MetricName` | `string` | (required) | OpenTelemetry metric name (e.g., "orders.created") |
| `Type` | `MetricType` | `Counter` | Type of metric to record |
| `ValueProperty` | `string?` | `null` | Property to use as metric value (required for Histogram/Gauge; numeric) |
| `Unit` | `string?` | `null` | Unit of measurement (e.g., "ms", "bytes", "USD") |
| `Properties` | `string[]?` | `null` | Properties to use as metric dimensions/labels |
| `ExtraJson` | `string?` | `null` | Additional metadata |

#### MetricType {#metric-type}

| Value | Numeric | Description | Value Source |
|-------|---------|-------------|--------------|
| `Counter` | 0 | Monotonically increasing value | Defaults to 1 if `ValueProperty` not specified |
| `Histogram` | 1 | Distribution of values | Requires `ValueProperty` |
| `Gauge` | 2 | Point-in-time value | Requires `ValueProperty` |

> Verified: `src/Whizbang.Core/Tags/MetricType.cs`, `src/Whizbang.Core/Attributes/MetricTagAttribute.cs`.

### AuditEventAttribute {#audit-tag}

Ships in `Whizbang.Core.Attributes`. Marks an event type for selective auditing through the tag system — register an `IMessageTagHook<AuditEventAttribute>` to capture audited events. Unlike the three attributes above, it does not have a hardcoded fast path in the processor; it is dispatched through the generated custom-attribute dispatcher.

```csharp{title="AuditEvent Properties" description="Mark an event for selective auditing and register a matching audit hook" category="Attributes" difficulty="BEGINNER" tags=["Tags", "Audit", "API"] tests=["AuditEventAttributeTests.AuditEventAttribute_CanBeAppliedToEventRecordAsync", "AuditEventAttributeTests.AuditEventAttribute_Reason_CanBeSetAsync", "AuditEventAttributeTests.AuditEventAttribute_Level_CanBeSetAsync"]}
[AuditEvent(Reason = "PII access", Level = AuditLevel.Warning)]
public record CustomerDataViewed(Guid CustomerId, string ViewedBy) : IEvent;

services.AddWhizbang(options => {
  options.Tags.UseHook<AuditEventAttribute, AuditTagHook>();
});
```

**Properties**:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Tag` | `string` | `"audit"` | Set by the parameterless constructor |
| `Properties` | `string[]?` | `null` (all public properties) | Left null deliberately — audit captures the full event body |
| `Reason` | `string?` | `null` | Documents why the event requires auditing; stored on the audit entry |
| `Level` | `AuditLevel` | `Info` | Audit severity: `Info`, `Warning`, `Critical` |
| `Exclude` | `bool` | `false` | When system audit is enabled, opt this event type *out* of auditing |

`AuditEventAttribute` uses `AllowMultiple = false` (one per type). See [Audit Logging](../security/audit-logging.md#selective-auditing) for how it integrates with system audit.

> Verified: `src/Whizbang.Core/Attributes/AuditEventAttribute.cs` (`Tag = "audit"`, `Level = AuditLevel.Info`, `Exclude = false`, `[AttributeUsage(..., AllowMultiple = false)]`), `src/Whizbang.Core/Audit/AuditLevel.cs` (`Info`, `Warning`, `Critical`); `tests/Whizbang.Core.Tests/Audit/AuditEventAttributeTests.cs`, `tests/Whizbang.Core.Tests/SystemEvents/AuditEventAttributeExcludeTests.cs`.

## Message Tag Registry {#registry}

The `MessageTagRegistry` is a static registry that aggregates tag registrations from all loaded assemblies via the `AssemblyRegistry<IMessageTagRegistry>` pattern.

### How It Works

1. **Compile Time**: The source generator discovers tag attributes and generates an `IMessageTagRegistry` implementation per assembly
2. **Module Initialization**: `[ModuleInitializer]` registers the generated registry before `Main()` runs
3. **Runtime**: `MessageTagProcessor` queries the registry to find tags for message types

```csharp{title="Registry Architecture" description="What MessageTagDiscoveryGenerator emits per assembly — a registry plus a [ModuleInitializer] that always registers at priority 100" category="Messaging" difficulty="ADVANCED" tags=["Tags", "Registry", "Multi-Assembly"] tests=["MessageTagDiscoveryGeneratorTests.Generator_WithTaggedTypes_ImplementsIMessageTagRegistryAsync", "MessageTagDiscoveryGeneratorTests.Generator_WithTaggedTypes_GeneratesModuleInitializerAsync", "MessageTagDiscoveryGeneratorTests.Generator_WithTaggedTypes_UsesPriority100ForContractsAsync"]}
// Generated by MessageTagDiscoveryGenerator per assembly:
internal sealed class GeneratedMessageTagRegistry_MyAssembly : IMessageTagRegistry {
  public static readonly GeneratedMessageTagRegistry_MyAssembly Instance = new();

  public IEnumerable<MessageTagRegistration> GetTagsFor(Type messageType) {
    if (messageType == typeof(OrderCreatedEvent)) {
      yield return new MessageTagRegistration {
        MessageType = typeof(OrderCreatedEvent),
        AttributeType = typeof(SignalTagAttribute),
        Tag = "order-created",
        Properties = new[] { "OrderId", "CustomerId" },
        PayloadBuilder = _buildPayloadForOrderCreatedEvent,     // source-generated, zero reflection
        AttributeFactory = () => new SignalTagAttribute {
          Tag = "order-created",
          Properties = new[] { "OrderId", "CustomerId" }
        }
      };
    }
  }

  private static JsonElement _buildPayloadForOrderCreatedEvent(object message) {
    var evt = (OrderCreatedEvent)message;
    return JsonSerializer.SerializeToElement(new { evt.OrderId, evt.CustomerId });
  }
}

// Generated module initializer — emitted verbatim for EVERY assembly, contracts or services:
file static class ModuleInitializer {
  [ModuleInitializer]
  internal static void Initialize() {
    // The generator ALWAYS emits priority: 100 here; there is no contracts-vs-services branch.
    MessageTagRegistry.Register(
        GeneratedMessageTagRegistry_MyAssembly.Instance,
        priority: 100);
  }
}
```

### Static Registry API

```csharp{title="Using MessageTagRegistry" description="Query the aggregated tag registry and inspect registration metadata for diagnostics" category="API" difficulty="ADVANCED" tags=["Tags", "Registry", "API"]}
// Query tags for a message type (queries every registered registry, yields all matches)
var tags = MessageTagRegistry.GetTagsFor(typeof(OrderCreatedEvent));

foreach (var registration in tags) {
  Console.WriteLine($"Tag: {registration.Tag}");
  Console.WriteLine($"Attribute Type: {registration.AttributeType.Name}");
  Console.WriteLine($"Properties: {string.Join(", ", registration.Properties ?? [])}");
}

// Register a registry by hand (normally the generated [ModuleInitializer] does this).
// The MANUAL overload defaults priority to 1000, but generated registrations always
// pass 100 explicitly — so hand-registration is rare.
MessageTagRegistry.Register(customRegistry, priority: 500);

// Diagnostic: count registered registries
var registryCount = MessageTagRegistry.Count;
```

> Verified: `src/Whizbang.Core/Tags/MessageTagRegistry.cs` — `Register(IMessageTagRegistry registry, int priority = 1000)`, `GetTagsFor(Type)` (iterates every registered registry and yields every matching registration), `Count`.

### Multi-Assembly Support

Tags can be defined in different assemblies — for example, tagged events in a contracts assembly and more tagged events (or hooks) in a services assembly. Each assembly that contains tagged types gets its own source-generated `IMessageTagRegistry`, and the generated `[ModuleInitializer]` registers it.

**Every generated registry auto-registers at priority `100`.** The generator emits the identical `MessageTagRegistry.Register(instance, priority: 100)` for every assembly, whether it is a "contracts" or a "services" assembly — there is no assembly-role branching in `MessageTagDiscoveryGenerator`.

The value `1000` appears in only two places, and **auto-registration never uses it**:

- the **default parameter** of the *manual* `MessageTagRegistry.Register(IMessageTagRegistry, int priority = 1000)` overload, and
- an aspirational "use 100 for contracts, 1000 for services" note in that method's XML doc.

Because a contracts registry and a services registry both land at priority `100`, any ordering between them is decided by `AssemblyRegistry`'s tie-break at equal priority — not by an assembly-role priority. This rarely matters in practice: `GetTagsFor` queries **every** registered registry and yields **all** matching registrations, so a message type tagged in one assembly is found regardless of which registry is queried first.

> Verified: `src/Whizbang.Generators/MessageTagDiscoveryGenerator.cs` emits `MessageTagRegistry.Register(..., priority: 100)` (registry) and `MessageTagHookDispatcherRegistry.Register(..., priority: 100)` (dispatcher) for every assembly; the only `1000` in the codebase is the default of the manual `MessageTagRegistry.Register` overload and its XML-doc convention (`src/Whizbang.Core/Tags/MessageTagRegistry.cs`).

### Custom Attribute Dispatcher {#dispatcher-registry}

For tag attributes that are not one of the three fast-path built-ins (including `AuditEventAttribute` and any user-defined attribute), the source generator also produces a `MessageTagHookDispatcher` registered in `MessageTagHookDispatcherRegistry`. It builds the typed `TagContext<TAttribute>` and invokes the typed hook **without reflection**:

```csharp{title="Generated Dispatcher Architecture" description="How custom-attribute hooks are dispatched without reflection, and how the generated dispatcher establishes ambient scope before invoking the hook" category="Messaging" difficulty="ADVANCED" tags=["Tags", "Custom-Attributes", "AOT", "Source-Generation"] tests=["MessageTagDiscoveryGeneratorTests.GeneratedDispatcher_TryCreateContext_ReturnsTypedContextAsync", "MessageTagDiscoveryGeneratorTests.GeneratedDispatcher_TryDispatchAsync_InvokesHookAsync", "MessageTagDiscoveryGeneratorTests.Generator_WithCustomAttributes_GeneratesDispatcherAsync"]}
internal sealed class GeneratedMessageTagHookDispatcher_MyAssembly : IMessageTagHookDispatcher {
  public static readonly GeneratedMessageTagHookDispatcher_MyAssembly Instance = new();

  public object? TryCreateContext(
      Type attributeType, MessageTagAttribute attribute, object message,
      Type messageType, JsonElement payload, IScopeContext? scope, LifecycleStage stage) {
    if (attributeType == typeof(AuditEventAttribute)) {
      return new TagContext<AuditEventAttribute> {
        Attribute = (AuditEventAttribute)attribute,
        Message = message, MessageType = messageType,
        Payload = payload, Scope = scope, Stage = stage
      };
    }
    return null;
  }

  public async ValueTask<JsonElement?> TryDispatchAsync(
      object hookInstance, object context, Type attributeType, CancellationToken ct) {
    if (attributeType == typeof(AuditEventAttribute) &&
        hookInstance is IMessageTagHook<AuditEventAttribute> typedHook &&
        context is TagContext<AuditEventAttribute> typedContext) {
      // Establish ambient scope so the hook can read the security context via
      // ScopeContextAccessor.CurrentContext (AsyncLocal), not just context.Scope.
      if (typedContext.Scope is not null) {
        ScopeContextAccessor.CurrentContext = typedContext.Scope;
      }
      return await typedHook.OnTaggedMessageAsync(typedContext, ct);
    }
    return null;
  }
}
```

**Ambient scope.** The generated dispatcher sets `ScopeContextAccessor.CurrentContext = ctx.Scope` (an `AsyncLocal`) *before* invoking a custom-attribute hook. This is what lets custom-attribute hooks — `AuditEventAttribute`, and JDNext's `NotificationTagAttribute` — that read the security context through `IScopeContextAccessor` / `ScopeContextAccessor.CurrentContext` work correctly, even when they never touch `context.Scope` directly. This is the exact behavior `TagHookStageFilteringAndScopeTests` was written to lock in. The three built-in fast-path hooks (`SignalTagAttribute`/`TelemetryTagAttribute`/`MetricTagAttribute`) do **not** get ambient scope set by the processor — they rely on the caller's `AsyncLocal` (the Dispatcher establishes `ScopeContextAccessor.CurrentContext` on the way in). Either way, every hook still receives the scope directly on `TagContext.Scope`.

**Key Points**:
- `SignalTagAttribute`, `TelemetryTagAttribute`, `MetricTagAttribute` (and the universal `MessageTagAttribute`) have hardcoded fast paths in `MessageTagProcessor`
- All other attributes get generated dispatchers for AOT-compatible hook invocation
- The generated dispatcher establishes **ambient scope** (`ScopeContextAccessor.CurrentContext`) for custom-attribute hooks; built-in fast-path hooks rely on the caller's `AsyncLocal`
- Zero reflection at runtime — all dispatch code is source-generated
- Each assembly with custom attributes gets its own dispatcher, and (like the tag registry) it auto-registers at priority `100`

> Verified: `src/Whizbang.Generators/MessageTagDiscoveryGenerator.cs` (the generated `TryDispatchAsync` sets `ScopeContextAccessor.CurrentContext = ctx.Scope` before invoking the hook); `src/Whizbang.Core/Tags/MessageTagProcessor.cs` (`_tryInvokeBuiltInHookAsync` fast-paths `MessageTagAttribute`/`SignalTagAttribute`/`TelemetryTagAttribute`/`MetricTagAttribute`; everything else routes through `MessageTagHookDispatcherRegistry.TryDispatchAsync`); `src/Whizbang.Core/Security/ScopeContextAccessor.cs`.

## Message Tag Registration {#registration}

Each `MessageTagRegistration` (a `sealed record`) contains metadata for one tagged message type:

| Property | Type | Description |
|----------|------|-------------|
| `MessageType` | `Type` | The message type with the tag attribute |
| `AttributeType` | `Type` | The tag attribute type (e.g. `SignalTagAttribute`) |
| `Tag` | `string` | The tag value from the attribute |
| `Properties` | `string[]?` | Property names to extract |
| `ExtraJson` | `string?` | Additional JSON to merge |
| `PayloadBuilder` | `Func<object, JsonElement>` | Source-generated delegate for building payload (zero reflection) |
| `AttributeFactory` | `Func<MessageTagAttribute>` | Source-generated factory for creating the attribute instance |

**Key Point**: `PayloadBuilder` is a **source-generated delegate** that extracts properties without reflection, ensuring AOT compatibility and high performance.

> **`Properties` metadata nuance.** The generator only emits the `Properties` field on `MessageTagRegistration` when the attribute lists at least one property — so an explicit empty array `[]` and an omitted (null) `Properties` both surface here as `null`. The two are still distinguished where it matters: the source-generated `PayloadBuilder` extracts *nothing* for `[]` and *every public property* for null.

## Custom Tag Attributes {#custom-tags}

Create domain-specific tag attributes by inheriting from `MessageTagAttribute`:

```csharp{title="Custom Tag Attribute" description="Define, apply, implement, and register a domain-specific Slack notification tag" category="Attributes" difficulty="INTERMEDIATE" tags=["Tags", "Custom-Attributes", "Extensibility"] tests=["MessageTagDiscoveryGeneratorTests.Generator_WithCustomAttribute_GeneratesRegistrationAsync", "MessageTagDiscoveryGeneratorTests.Generator_WithCustomAttributes_GeneratesDispatcherAsync"]}
// 1. Define the attribute
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, AllowMultiple = true, Inherited = true)]
public sealed class SlackNotificationAttribute : MessageTagAttribute {
  public required string Channel { get; init; }
  public string Emoji { get; init; } = ":bell:";
  public SlackColor Color { get; init; } = SlackColor.Info;
  public bool MentionOnCall { get; init; }
}

// 2. Apply to messages
[SlackNotification(
    Tag = "deployment-failed",
    Channel = "#deployments",
    Emoji = ":rotating_light:",
    Color = SlackColor.Danger,
    MentionOnCall = true,
    Properties = ["Version", "Environment", "Error"])]
public record DeploymentFailedEvent(string Version, string Environment, string Error) : IEvent;

// 3. Implement the hook
public class SlackNotificationHook : IMessageTagHook<SlackNotificationAttribute> {
  private readonly ISlackClient _slackClient;
  public SlackNotificationHook(ISlackClient slackClient) => _slackClient = slackClient;

  public async ValueTask<JsonElement?> OnTaggedMessageAsync(
      TagContext<SlackNotificationAttribute> context, CancellationToken ct) {
    var attr = context.Attribute;
    await _slackClient.SendMessageAsync(new SlackMessage {
      Channel = attr.Channel,
      IconEmoji = attr.Emoji,
      // ...build from context.Payload...
    }, ct);
    return null;
  }
}

// 4. Register the hook
services.AddWhizbang(options => {
  options.Tags.UseHook<SlackNotificationAttribute, SlackNotificationHook>();
});
```

### Positional Constructor Arguments {#positional-ctor-args}

:::new
**v1.0.0**: `MessageTagDiscoveryGenerator` preserves positional constructor args when reconstructing tag-attribute instances. Previously these were silently dropped — only `Tag` and named arguments survived the round-trip through the generated `AttributeFactory`, so any value passed to a positional ctor parameter (like `tagValue`) was reset to its default at runtime.
:::

Tag attributes commonly accept positional constructor arguments alongside `Tag`:

```csharp{title="Tag Attribute With Positional Ctor Args" description="A tag attribute whose ctor takes (tag, tagValue) — both are preserved by the generator's AttributeFactory" category="Attributes" difficulty="INTERMEDIATE" tags=["Tags", "Custom-Attributes", "Positional-Args"] tests=["MessageTagDiscoveryGeneratorTests.Generator_PositionalCtorArg_EmittedAsPascalCasePropertyInitializerAsync"]}
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public class TabTagAttribute : MessageTagAttribute {
  public string? TagValue { get; init; }   // Must be init-settable for the generator's factory.

  public TabTagAttribute() { Tag = string.Empty; TagValue = null; }

  public TabTagAttribute(string tag, string tagValue) {
    Tag = tag;
    TagValue = tagValue;
  }
}

// Usage:
[TabTag("user-tabs", "{UserID}")]
public class TabUpdatedEvent : IEvent {
  public Guid UserID { get; init; }
}
```

The generator emits an `AttributeFactory` that initializes BOTH `Tag` and `TagValue`, so the hook receives `context.Attribute.TagValue == "{UserID}"` and can substitute the placeholder against the payload.

**Requirements:**
- Properties storing positional ctor args must be **`init`-settable** (not getter-only) so the generator's object initializer can write them.
- Constructor parameter names must follow your declared naming convention (default: PascalCase). Parameter `tagValue` initializes property `TagValue`, `propertyName` → `PropertyName`, etc.

### AttributeArgNaming Convention {#arg-naming-convention}

When constructor parameter names don't follow the default PascalCase convention, declare an explicit convention with `[AttributeArgNaming]`:

```csharp{title="Custom Naming Convention" description="Override the constructor-parameter to property mapping with [AttributeArgNaming]" category="Attributes" difficulty="ADVANCED" tags=["Tags", "Custom-Attributes", "Conventions"] tests=["AttributeArgNamingAttributeTests.Constructor_AcceptsIdentityAsync", "MessageTagDiscoveryGeneratorTests.Generator_PositionalCtorArg_RespectsIdentityConventionAsync"]}
using Whizbang.Core.Attributes;

[AttributeArgNaming(AttributeArgNamingConvention.Identity)]   // No transform.
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
public class IdTagAttribute : MessageTagAttribute {
  public string? PropertyName { get; init; }

  public IdTagAttribute() { Tag = string.Empty; }

  // Parameter is already PascalCase — Identity preserves it verbatim.
  public IdTagAttribute(string tag, string PropertyName) {
    Tag = tag;
    this.PropertyName = PropertyName;
  }
}
```

**Available conventions** (`AttributeArgNamingConvention`):

| Convention | Numeric | Input → Output | Use case |
|---|---|---|---|
| `PascalCase` (default) | 0 | `tagValue` → `TagValue` | Standard C# (camelCase params, PascalCase props) |
| `Identity` | 1 | `TagValue` → `TagValue` | Parameter already matches property |
| `CamelCase` | 2 | `TagValue` → `tagValue` | Properties follow camelCase |
| `SnakeCase` | 3 | `tagValue` → `tag_value` | Properties follow snake_case |
| `KebabCase` | 4 | `tagValue` → `tag-value` | Properties follow kebab-case |
| `UpperSnake` | 5 | `tagValue` → `TAG_VALUE` | Properties follow UPPER_SNAKE |

The `[AttributeArgNaming]` attribute is inherited — declaring it on a base tag attribute applies to all subclasses. The convention only affects positional ctor args; named arguments use their declared names verbatim regardless.

> Verified: `src/Whizbang.Core/Attributes/AttributeArgNamingConvention.cs`, `src/Whizbang.Core/Attributes/AttributeArgNamingAttribute.cs`, `src/Whizbang.Generators/Utilities/AttributeArgNamingHelper.cs`; `tests/Whizbang.Core.Tests/Attributes/AttributeArgNamingAttributeTests.cs`, `tests/Whizbang.Generators.Tests/AttributeArgNamingHelperTests.cs`.

## Hook Implementation Patterns

### Payload Modification

Hooks can modify the payload for subsequent hooks in the chain by returning a new `JsonElement` (return `null` to pass the original through):

```csharp{title="Payload Modification Hook" description="Enrich the payload for the next hook by returning a modified JsonElement" category="Messaging" difficulty="ADVANCED" tags=["Tags", "Hooks", "Payload-Modification"] tests=["MessageTagHookTests.Hook_ReturnsModifiedPayload_NextHookReceivesModifiedPayloadAsync", "MessageTagProcessorTests.ProcessAsync_PassesModifiedPayloadToNextHookAsync"]}
public class EnrichmentHook : IMessageTagHook<SignalTagAttribute> {
  private readonly IUserService _userService;
  public EnrichmentHook(IUserService userService) => _userService = userService;

  public async ValueTask<JsonElement?> OnTaggedMessageAsync(
      TagContext<SignalTagAttribute> context, CancellationToken ct) {
    var customerId = context.Payload.GetProperty("CustomerId").GetGuid();
    var customerName = await _userService.GetCustomerNameAsync(customerId, ct);

    var enriched = new Dictionary<string, object?>();
    foreach (var prop in context.Payload.EnumerateObject())
      enriched[prop.Name] = prop.Value;
    enriched["CustomerName"] = customerName;

    return JsonSerializer.SerializeToElement(enriched); // Passed to the next hook
  }
}

// Register enrichment hook first (lower priority runs earlier)
options.Tags.UseHook<SignalTagAttribute, EnrichmentHook>(priority: -200);
options.Tags.UseHook<SignalTagAttribute, SignalRNotificationHook>(priority: 0);
```

### Universal Hook (All Tag Types)

`UseUniversalHook<THook>()` registers a hook typed on the base `MessageTagAttribute`, so it receives *every* tagged message. It shares the same `priority` / `fireAt` parameters as `UseHook`:

```csharp{title="Universal Tag Hook" description="A hook typed on MessageTagAttribute that logs every tagged message across all attribute types" category="Messaging" difficulty="ADVANCED" tags=["Tags", "Hooks", "Universal"] tests=["TagOptionsTests.UseUniversalHook_RegistersForMessageTagAttributeAsync", "MessageTagProcessorTests.ProcessAsync_InvokesUniversalHookForAnyTagAsync"]}
public class UniversalTagLoggerHook : IMessageTagHook<MessageTagAttribute> {
  private readonly ILogger<UniversalTagLoggerHook> _logger;
  public UniversalTagLoggerHook(ILogger<UniversalTagLoggerHook> logger) => _logger = logger;

  public ValueTask<JsonElement?> OnTaggedMessageAsync(
      TagContext<MessageTagAttribute> context, CancellationToken ct) {
    _logger.LogInformation(
        "Tagged message processed: {MessageType} with {AttributeType} (Tag: {Tag})",
        context.MessageType.Name, context.AttributeType.Name, context.Attribute.Tag);
    return ValueTask.FromResult<JsonElement?>(null);
  }
}

options.Tags.UseUniversalHook<UniversalTagLoggerHook>(priority: -1000);
```

> `UseUniversalHook<THook>(priority = -100, fireAt = null)` delegates to `UseHook<MessageTagAttribute, THook>` — `src/Whizbang.Core/Tags/TagOptions.cs`. When resolving hooks for a specific attribute, `GetHooksFor` includes both attribute-typed hooks and universal (`MessageTagAttribute`) hooks.

## DI Lifetime and Scoping {#di-lifetime}

- `IMessageTagProcessor`: **Singleton** (registered automatically)
- Tag Hooks: **Scoped** — the processor creates a fresh async scope per `ProcessTagsAsync` call (`_scopeFactory.CreateAsyncScope()`); all hooks invoked during that call share the scope, which is disposed when the call completes.

### What This Enables

- **Scoped Services Work**: Inject `DbContext`, `IHttpContextAccessor`, etc.
- **Shared Scope**: Multiple hooks in the same processing call share the same `DbContext` instance (hook 2 sees entities added by hook 1).
- **Fresh Scope Per Dispatch**: Each message gets a new scope.

### Pitfall

Don't store scope-dependent state in hook fields across calls — the injected scoped services belong to *one* `ProcessTagsAsync` call:

```csharp{title="Scope Lifetime Pitfalls" description="Why accumulating state across calls leaks: the DbContext is scoped to a single ProcessTagsAsync call" category="Messaging" difficulty="INTERMEDIATE" tags=["Tags", "DI", "Pitfalls"] tests=["MessageTagProcessorTests.ProcessTagsAsync_WithScopeFactory_MultipleHooksShareSameScope_Async", "MessageTagProcessorTests.ProcessTagsAsync_WithScopeFactory_DisposesScope_Async"]}
// ❌ WRONG - accumulating state across calls; the DbContext is scoped to a single call.
public class BadHook : IMessageTagHook<SignalTagAttribute> {
  private readonly MyDbContext _db;
  private readonly List<Notification> _pending = new(); // ❌ leaks across dispatches
  // ...
}

// ✅ CORRECT - do all work within the method, save immediately.
public class GoodHook : IMessageTagHook<SignalTagAttribute> {
  private readonly MyDbContext _db;
  public async ValueTask<JsonElement?> OnTaggedMessageAsync(
      TagContext<SignalTagAttribute> context, CancellationToken ct) {
    _db.Notifications.Add(new Notification { /* ... */ });
    await _db.SaveChangesAsync(ct);
    return null;
  }
}
```

> Verified: `src/Whizbang.Core/Tags/MessageTagProcessor.cs` creates one async scope per call via `IServiceScopeFactory.CreateAsyncScope()` and resolves all hooks from it.

## Multi-Concern Example

Combine multiple tag types on a single message — each registered hook fires automatically when the event is dispatched:

```csharp{title="Multi-Concern Event Tagging" description="One event carrying signal, telemetry, two metric, and audit tags — each fires its own hook on dispatch" category="Attributes" difficulty="ADVANCED" tags=["Tags", "Multi-Concern", "Telemetry", "Metrics", "Notifications"] tests=["MessageTagProcessorTests.ProcessTagsAsync_WithMultipleTags_ProcessesAllAsync", "MessageTagDiscoveryGeneratorTests.Generator_WithMultipleTagAttributes_DiscoversAllAsync", "MessageTagDiscoveryGeneratorTests.Generator_WithMultipleSameTypeAttributes_DiscoversAllAsync"]}
[SignalTag(
    Tag = "payment-completed",
    Properties = ["PaymentId", "OrderId", "Amount"],
    Group = "customer-{CustomerId}",
    Priority = SignalPriority.High)]
[TelemetryTag(
    Tag = "payment-trace",
    SpanName = "CompletePayment",
    Kind = SpanKind.Internal,
    Properties = ["PaymentId", "Gateway"])]
[MetricTag(
    Tag = "payment-amount",
    MetricName = "payments.amount",
    Type = MetricType.Histogram,
    ValueProperty = "Amount",
    Properties = ["Gateway", "Currency"],
    Unit = "USD")]
[MetricTag(
    Tag = "payment-count",
    MetricName = "payments.total",
    Type = MetricType.Counter,
    Properties = ["Gateway", "Currency"])]
[AuditEvent(Reason = "Financial transaction", Level = AuditLevel.Info)]
public record PaymentCompletedEvent(
    Guid PaymentId,
    Guid OrderId,
    Guid CustomerId,
    decimal Amount,
    string Currency,
    string Gateway,
    DateTime CompletedAt) : IEvent;

// On dispatch:
// 1. SignalR notification sent to customer-{CustomerId} group
// 2. OpenTelemetry span created/enriched
// 3. Histogram metric recorded for payment amount
// 4. Counter metric incremented for payment count
// 5. Audit entry captured
```

## Troubleshooting {#troubleshooting}

### Tags not being processed?

1. Verify `EnableTagProcessing` is `true` (default).
2. Check that hooks are registered with `UseHook<>()`.
3. Ensure the message type is `public` (private types are not discovered by the generator).
4. Verify the attribute inherits from `MessageTagAttribute`.
5. If applying multiple tags of the same attribute type, ensure `[AttributeUsage]` allows `AllowMultiple = true`.
6. Check that the assembly references `Whizbang.Generators`.

```csharp{title="Debugging Tag Processing" description="Check whether any tags are registered for a message type and how many registries are loaded" category="Diagnostics" difficulty="BEGINNER" tags=["Tags", "Debugging", "Registry"]}
var tags = MessageTagRegistry.GetTagsFor(typeof(OrderCreatedEvent));
if (!tags.Any()) {
  Console.WriteLine("No tags registered for OrderCreatedEvent");
  Console.WriteLine($"Registry count: {MessageTagRegistry.Count}");
}
```

### Hook not firing?

1. Check the hook is registered for the correct attribute type.
2. Verify the hook is registered with DI (automatically done by `UseHook`).
3. Check `TagProcessingMode` — if using `AsLifecycleStage`, hooks fire later.
4. If you registered the hook with `fireAt:`, it only fires at that lifecycle stage — confirm processing actually reaches that stage.
5. Ensure the receptor completed successfully (hooks only fire after success).

### Hook firing more than once?

This can be expected. `ProcessTagsAsync` may be called at multiple lifecycle stages. Either register the hook with a `fireAt:` stage so the framework only invokes it once, or filter inside the hook with `context.Stage`:

```csharp{title="Skip a hook until data is committed" description="Filter inside the hook on context.Stage so it only acts once, at the committed stage" category="Messaging" difficulty="INTERMEDIATE" tags=["Tags", "LifecycleStage", "Hooks"] tests=["MessageTagProcessorTests.ProcessTagsAsync_HookCanFilterByStage_OnlyActsOnPostPerspectiveDetachedAsync", "MessageTagProcessorTests.ProcessTagsAsync_PassesStageToHookContext_AllStagesAsync"]}
if (context.Stage != LifecycleStage.PostPerspectiveInline)
  return null; // Skip — only act when data is committed
```

### Multi-assembly issues?

1. Ensure both assemblies reference `Whizbang.Generators`.
2. Check that `[ModuleInitializer]` is running.
3. Both assemblies' generated registries auto-register at priority `100` — there is no contracts-vs-services priority split. Confirm each assembly is actually **loaded** (a registry only registers once its assembly's module initializer runs).
4. Verify the assemblies are loaded at runtime.

### Payload not containing expected data?

1. Verify property names in the `Properties` array match event property names (case-sensitive).
2. Check that the properties are public and have getters.
3. If you need a field that isn't in `Properties`, read it from `TagContext.Message` directly rather than from `Payload`.

## Performance Considerations

### Zero Reflection

Tag processing uses **zero reflection** at runtime:
- Payload builders are **source-generated delegates**
- Attribute factories are **source-generated**
- No `MethodInfo.Invoke()` or `Activator.CreateInstance()` at runtime

### AOT Compatibility

Full Native AOT support — the source generator discovers tags at compile time and all delegates are compiled ahead-of-time.

### Memory Efficiency

- `MessageTagProcessor` is a singleton
- One scope is created per dispatch (not per hook)
- Hooks return `ValueTask` to minimize allocations; a hook that has nothing to do returns a completed `ValueTask` synchronously

## See Also

- [Lifecycle Stages](../lifecycle/lifecycle-stages.md) - When tags are processed in the pipeline
- [Audit Logging](../security/audit-logging.md) - Selective auditing via `AuditEventAttribute`
- [WhizbangCoreOptions](../../operations/configuration/whizbang-options.md) - `EnableTagProcessing`, `TagProcessingMode` reference
- [Assembly Registry](../identity/assembly-registry.md) - Multi-assembly pattern used by the tag registry
