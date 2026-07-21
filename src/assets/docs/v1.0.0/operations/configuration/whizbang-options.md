---
title: WhizbangCoreOptions
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Configuration
order: 1
description: >-
  Complete reference for WhizbangCoreOptions - configure tag processing, hooks,
  and core Whizbang behavior
tags: 'configuration, options, tags, hooks, addwhizbang'
codeReferences:
  - src/Whizbang.Core/Configuration/WhizbangCoreOptions.cs
  - src/Whizbang.Core/Tags/TagOptions.cs
  - src/Whizbang.Core/ServiceCollectionExtensions.cs
testReferences:
  - tests/Whizbang.Core.Tests/Configuration/WhizbangCoreOptionsTests.cs
  - tests/Whizbang.Core.Tests/Tags/TagOptionsTests.cs
  - tests/Whizbang.Core.Tests/ServiceCollectionExtensionsTests.cs
lastMaintainedCommit: '01f07906'
---

# WhizbangCoreOptions

`WhizbangCoreOptions` is the central configuration class for Whizbang. Pass a configuration lambda to `AddWhizbang()` to customize behavior.

## Basic Usage

```csharp{title="Basic Configuration" description="Configure Whizbang with options lambda" category="Configuration" difficulty="BEGINNER" tags=["Configuration", "AddWhizbang"] tests=["ServiceCollectionExtensionsTests.AddWhizbang_WithOptionsLambda_RegistersWhizbangCoreOptions_Async", "ServiceCollectionExtensionsTests.AddWhizbang_WithOptionsLambda_RegistersTagOptions_Async"]}
services.AddWhizbang(options => {
  // Configure tag processing
  options.Tags.UseHook<NotificationTagAttribute, MyNotificationHook>();

  // Change processing mode
  options.TagProcessingMode = TagProcessingMode.AsLifecycleStage;

  // Disable tag processing entirely
  options.EnableTagProcessing = false;
});
```

## Properties

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `EnableTagProcessing` | `bool` | `true` | Master switch for message tag processing |
| `TagProcessingMode` | `TagProcessingMode` | `AfterReceptorCompletion` | When tag hooks run in the pipeline |
| `Tags` | `TagOptions` | — | Tag hook registration (see below) |
| `Tracing` | `TracingOptions` | — | Handler/message tracing configuration (see [Tracing](../observability/tracing)) |
| `Services` | `ServiceRegistrationOptions` | — | Auto-registration behavior for discovered Lenses/Perspectives (see [ServiceRegistrationOptions](service-registration-options)) |
| `DefaultQueryScope` | `QueryScope` | `QueryScope.Tenant` | Default scope filtering for `ILensQuery<TModel>.DefaultScope` queries |
| `ShowBanner` | `bool` | `true` | Print the ASCII art banner on startup (the version log line always prints) |
| `ImmediateDetachedChainWarningThreshold` | `int` | `10` | Warn when ImmediateDetached dispatch chains reach a multiple of this depth (no hard limit) |
| `EmptyStreamIdPolicy` | `EmptyStreamIdPolicy` | `Reject` | How rows with `stream_id = Guid.Empty` are handled (see [Empty Stream ID Policy](empty-stream-id-policy)) |

### EnableTagProcessing

| Property | Type | Default |
|----------|------|---------|
| `EnableTagProcessing` | `bool` | `true` |

Controls whether message tag processing is enabled. Set to `false` to disable all tag hook invocations.

```csharp{title="Disable Tag Processing" description="Turn off tag processing entirely" category="Configuration" difficulty="BEGINNER" tags=["Configuration", "Tags"] tests=["WhizbangCoreOptionsTests.EnableTagProcessing_CanBeSetToFalse_Async", "ServiceCollectionExtensionsTests.AddWhizbang_WithOptionsLambda_RegistersWhizbangCoreOptions_Async"]}
services.AddWhizbang(options => {
  options.EnableTagProcessing = false; // No hooks will fire
});
```

### TagProcessingMode {#tag-processing-mode}

| Property | Type | Default |
|----------|------|---------|
| `TagProcessingMode` | `TagProcessingMode` | `AfterReceptorCompletion` |

Controls when tag hooks are executed in the message processing pipeline.

#### AfterReceptorCompletion (Default)

Tags are processed immediately after receptor completion, before lifecycle stages:

```
Message → Receptor → Cascade Events → TAG PROCESSING → Lifecycle Stages
```

#### AsLifecycleStage

Tags are processed during lifecycle invocation. Use this when hooks depend on lifecycle receptors completing first:

```
Message → Receptor → Cascade Events → Lifecycle Stages → TAG PROCESSING
```

```csharp{title="Lifecycle Stage Mode" description="Process tags after lifecycle stages" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Tags", "Lifecycle"] tests=["WhizbangCoreOptionsTests.TagProcessingMode_CanBeSetToAsLifecycleStage_Async", "ServiceCollectionExtensionsTests.AddWhizbang_WithOptionsLambda_RegistersWhizbangCoreOptions_Async"]}
services.AddWhizbang(options => {
  options.TagProcessingMode = TagProcessingMode.AsLifecycleStage;
});
```

### Tags

| Property | Type |
|----------|------|
| `Tags` | `TagOptions` |

Access to tag-specific configuration options. See [TagOptions](#tagoptions) below.

## TagOptions

`TagOptions` configures message tag hook registration and behavior.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `HookRegistrations` | `IReadOnlyList<TagHookRegistration>` | empty | The registered hook configurations |
| `PayloadSizeWarningThresholdBytes` | `int?` | `8192` | Log a warning when a built tag payload exceeds this size (raw JSON text length); `null` disables |
| `PayloadSizeErrorThresholdBytes` | `int?` | `null` | Throw `InvalidOperationException` instead of dispatching when the payload exceeds this size (evaluated before hooks run); `null` disables |

### UseHook&lt;TAttribute, THook&gt;

Register a hook for a specific tag attribute type:

```csharp{title="Register Tag Hook" description="Register a hook for SignalTagAttribute" category="Configuration" difficulty="BEGINNER" tags=["Configuration", "Tags", "Hooks"] tests=["WhizbangCoreOptionsTests.Tags_UseHook_AddsRegistration_Async", "TagOptionsTests.UseHook_AddsRegistrationToListAsync"]}
services.AddWhizbang(options => {
  options.Tags.UseHook<SignalTagAttribute, SignalRNotificationHook<NotificationHub>>();
});
```

#### With Priority

Control execution order with priority (lower values execute first). The **default priority is `-100`** (fires first):

```csharp{title="Hook Priority" description="Control hook execution order" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Tags", "Priority"] tests=["TagOptionsTests.UseHook_AcceptsCustomPriorityAsync", "TagOptionsTests.UseHook_UsesDefaultPriorityAsync", "TagOptionsTests.GetHooksInExecutionOrder_SortsByPriorityAscendingAsync"]}
services.AddWhizbang(options => {
  options.Tags.UseHook<SignalTagAttribute, ValidationHook>(priority: -100);    // First (default)
  options.Tags.UseHook<SignalTagAttribute, NotificationHook>(priority: 0);     // After
  options.Tags.UseHook<SignalTagAttribute, AuditHook>(priority: 500);          // Last
});
```

#### With Lifecycle Stage

`UseHook` also accepts an optional `fireAt` parameter to restrict a hook to a specific `LifecycleStage`. When `fireAt` is `null` (the default), the hook fires at all stages:

```csharp{title="Stage-Restricted Hook" description="Fire a hook only at a specific lifecycle stage" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Tags", "Lifecycle"] tests=["TagOptionsTests.UseHook_AcceptsCustomFireAtAsync", "TagOptionsTests.UseHook_UsesDefaultFireAtNullForAllStagesAsync"]}
services.AddWhizbang(options => {
  options.Tags.UseHook<SignalTagAttribute, NotificationHook>(
    fireAt: LifecycleStage.PostPerspectiveInline);
});
```

### UseUniversalHook&lt;THook&gt;

Register a hook that fires for **all** tagged messages regardless of attribute type. The hook must implement `IMessageTagHook<MessageTagAttribute>`:

```csharp{title="Universal Hook" description="Hook that fires for all tagged messages" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Tags", "Universal"] tests=["WhizbangCoreOptionsTests.Tags_UseUniversalHook_WorksCorrectly_Async", "TagOptionsTests.UseUniversalHook_RegistersForMessageTagAttributeAsync"]}
services.AddWhizbang(options => {
  // This hook fires for every tagged message
  options.Tags.UseUniversalHook<LoggingHook>();

  // With priority
  options.Tags.UseUniversalHook<MetricsHook>(priority: 1000);
});
```

## Complete Configuration Example

```csharp{title="Complete Configuration" description="Full configuration example with all options" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Tags", "Example"] tests=["ServiceCollectionExtensionsTests.AddWhizbang_WithMultipleHooks_RegistersAllHookTypes_Async", "ServiceCollectionExtensionsTests.AddWhizbang_WithOptionsLambda_RegistersWhizbangCoreOptions_Async"]}
services.AddWhizbang(options => {
  // Enable tag processing (default is true)
  options.EnableTagProcessing = true;

  // Process tags after receptor completion (default)
  options.TagProcessingMode = TagProcessingMode.AfterReceptorCompletion;

  // Register built-in tag hooks
  // SignalRNotificationHook<THub> ships in Whizbang.SignalR;
  // OpenTelemetrySpanHook / OpenTelemetryMetricHook ship in Whizbang.Observability
  options.Tags.UseHook<SignalTagAttribute, SignalRNotificationHook<NotificationHub>>();
  options.Tags.UseHook<TelemetryTagAttribute, OpenTelemetrySpanHook>();
  options.Tags.UseHook<MetricTagAttribute, OpenTelemetryMetricHook>();

  // Register custom tag hooks (user-defined MessageTagAttribute subclasses)
  options.Tags.UseHook<AuditEventAttribute, AuditLogHook>();
  options.Tags.UseHook<SlackNotificationAttribute, SlackHook>();

  // Register hooks with priority (default is -100, lower fires first)
  options.Tags.UseHook<SignalTagAttribute, ValidationHook>(priority: -100);
  options.Tags.UseHook<SignalTagAttribute, EnrichmentHook>(priority: -50);

  // Universal hook for logging all tagged messages
  options.Tags.UseUniversalHook<TagLoggingHook>(priority: int.MaxValue);

  // Payload size guards
  options.Tags.PayloadSizeWarningThresholdBytes = 8192;  // default
  options.Tags.PayloadSizeErrorThresholdBytes = 65536;   // default: null (disabled)
});
```

## DI Registration

When you call `AddWhizbang(options => ...)`:

1. **WhizbangCoreOptions** is registered as Singleton (first call wins — `TryAddSingleton`)
2. **TagOptions** is registered as Singleton
3. **All hooks** are registered as Scoped (via `TryAddScoped`)
4. **IMessageTagProcessor** is registered as Singleton with `IServiceScopeFactory`
5. **Generated service registration callbacks** are invoked automatically — discovered Lenses and Perspectives are registered without an explicit `AddAllWhizbangServices()` call (see [ServiceRegistrationExtensions](service-registration))

`AddWhizbang()` returns a `WhizbangBuilder` for chaining storage configuration (e.g., `.WithEFCore<MyDbContext>().WithDriver.Postgres`).

### Multiple AddWhizbang Calls

`AddWhizbang()` can be called multiple times safely. The first call wins for option values; tag hook registrations from all calls are **merged** (duplicate attribute/hook pairs are skipped). This lets different parts of your startup code register hooks independently.

### Hook Lifetime

Hooks are **Scoped** services, meaning:

- ✅ Hooks can inject scoped services (`DbContext`, `IHttpContextAccessor`)
- ✅ Multiple hooks in the same processing call share the same scope
- ✅ Each message dispatch gets a fresh scope
- ✅ Scope is disposed after processing completes

```csharp{title="Hook with Scoped Dependencies" description="Hooks can safely inject scoped services" category="Implementation" difficulty="INTERMEDIATE" tags=["Hooks", "DI", "Scoped"] tests=["ServiceCollectionExtensionsTests.AddWhizbang_WithHooks_RegistersHookTypesAsScoped_Async"]}
public class AuditHook : IMessageTagHook<AuditEventAttribute> {
  private readonly MyDbContext _dbContext; // Scoped - works!
  private readonly IHttpContextAccessor _httpContext; // Scoped - works!

  public AuditHook(MyDbContext dbContext, IHttpContextAccessor httpContext) {
    _dbContext = dbContext;
    _httpContext = httpContext;
  }

  public async ValueTask<JsonElement?> OnTaggedMessageAsync(
      TagContext<AuditEventAttribute> context,
      CancellationToken ct) {
    // Use scoped services safely
    var userId = _httpContext.HttpContext?.User?.Identity?.Name;
    _dbContext.AuditLogs.Add(new AuditLog { ... });
    await _dbContext.SaveChangesAsync(ct);
    return null;
  }
}
```

## Backward Compatibility

The parameterless `AddWhizbang()` overload still works:

```csharp{title="Parameterless Overload" description="AddWhizbang without configuration" category="Configuration" difficulty="BEGINNER" tags=["Configuration", "Backward-Compatibility"] tests=["ServiceCollectionExtensionsTests.AddWhizbang_ParameterlessOverload_StillWorks_Async", "ServiceCollectionExtensionsTests.AddWhizbang_WithNullConfigure_UsesDefaults_Async"]}
// This still works - uses default options
services.AddWhizbang();

// Equivalent to:
services.AddWhizbang(options => { });
```

## See Also

- [Message Tags](../../fundamentals/messages/message-tags) - Complete tag processing guide
- [Lifecycle Stages](../../fundamentals/lifecycle/lifecycle-stages) - Pipeline timing reference
- [Dispatcher](../../fundamentals/dispatcher/dispatcher) - Message dispatch and routing
