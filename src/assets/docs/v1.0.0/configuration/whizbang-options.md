---
title: WhizbangCoreOptions
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
---

# WhizbangCoreOptions

`WhizbangCoreOptions` is the central configuration class for Whizbang. Pass a configuration lambda to `AddWhizbang()` to customize behavior.

## Basic Usage

```csharp{title="Basic Configuration" description="Configure Whizbang with options lambda" category="Configuration" difficulty="BEGINNER" tags=["Configuration", "AddWhizbang"]}
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

### EnableTagProcessing

| Property | Type | Default |
|----------|------|---------|
| `EnableTagProcessing` | `bool` | `true` |

Controls whether message tag processing is enabled. Set to `false` to disable all tag hook invocations.

```csharp{title="Disable Tag Processing" description="Turn off tag processing entirely" category="Configuration" difficulty="BEGINNER" tags=["Configuration", "Tags"]}
services.AddWhizbang(options => {
  options.EnableTagProcessing = false; // No hooks will fire
});
```

### TagProcessingMode

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

```csharp{title="Lifecycle Stage Mode" description="Process tags after lifecycle stages" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Tags", "Lifecycle"]}
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

### UseHook&lt;TAttribute, THook&gt;

Register a hook for a specific tag attribute type:

```csharp{title="Register Tag Hook" description="Register a hook for NotificationTagAttribute" category="Configuration" difficulty="BEGINNER" tags=["Configuration", "Tags", "Hooks"]}
services.AddWhizbang(options => {
  options.Tags.UseHook<NotificationTagAttribute, SignalRNotificationHook>();
});
```

#### With Priority

Control execution order with priority (lower values execute first):

```csharp{title="Hook Priority" description="Control hook execution order" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Tags", "Priority"]}
services.AddWhizbang(options => {
  options.Tags.UseHook<NotificationTagAttribute, ValidationHook>(priority: -100);  // First
  options.Tags.UseHook<NotificationTagAttribute, NotificationHook>(priority: 0);   // Default
  options.Tags.UseHook<NotificationTagAttribute, AuditHook>(priority: 500);        // Last
});
```

### UseUniversalHook&lt;THook&gt;

Register a hook that fires for **all** tagged messages regardless of attribute type:

```csharp{title="Universal Hook" description="Hook that fires for all tagged messages" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Tags", "Universal"]}
services.AddWhizbang(options => {
  // This hook fires for every tagged message
  options.Tags.UseUniversalHook<LoggingHook>();

  // With priority
  options.Tags.UseUniversalHook<MetricsHook>(priority: 1000);
});
```

## Complete Configuration Example

```csharp{title="Complete Configuration" description="Full configuration example with all options" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Tags", "Example"]}
services.AddWhizbang(options => {
  // Enable tag processing (default is true)
  options.EnableTagProcessing = true;

  // Process tags after receptor completion (default)
  options.TagProcessingMode = TagProcessingMode.AfterReceptorCompletion;

  // Register built-in tag hooks
  options.Tags.UseHook<NotificationTagAttribute, SignalRNotificationHook>();
  options.Tags.UseHook<TelemetryTagAttribute, OpenTelemetryHook>();
  options.Tags.UseHook<MetricTagAttribute, PrometheusMetricHook>();

  // Register custom tag hooks
  options.Tags.UseHook<AuditEventAttribute, AuditLogHook>();
  options.Tags.UseHook<SlackNotificationAttribute, SlackHook>();

  // Register hooks with priority
  options.Tags.UseHook<NotificationTagAttribute, ValidationHook>(priority: -100);
  options.Tags.UseHook<NotificationTagAttribute, EnrichmentHook>(priority: -50);

  // Universal hook for logging all tagged messages
  options.Tags.UseUniversalHook<TagLoggingHook>(priority: int.MaxValue);
});
```

## DI Registration

When you call `AddWhizbang(options => ...)`:

1. **WhizbangCoreOptions** is registered as Singleton
2. **TagOptions** is registered as Singleton
3. **All hooks** are registered as Scoped (via `TryAddScoped`)
4. **IMessageTagProcessor** is registered as Singleton with `IServiceScopeFactory`

### Hook Lifetime

Hooks are **Scoped** services, meaning:

- ✅ Hooks can inject scoped services (`DbContext`, `IHttpContextAccessor`)
- ✅ Multiple hooks in the same processing call share the same scope
- ✅ Each message dispatch gets a fresh scope
- ✅ Scope is disposed after processing completes

```csharp{title="Hook with Scoped Dependencies" description="Hooks can safely inject scoped services" category="Implementation" difficulty="INTERMEDIATE" tags=["Hooks", "DI", "Scoped"]}
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

```csharp{title="Parameterless Overload" description="AddWhizbang without configuration" category="Configuration" difficulty="BEGINNER" tags=["Configuration", "Backward-Compatibility"]}
// This still works - uses default options
services.AddWhizbang();

// Equivalent to:
services.AddWhizbang(options => { });
```

## See Also

- [Message Tags](../core-concepts/message-tags) - Complete tag processing guide
- [Lifecycle Stages](../core-concepts/lifecycle-stages) - Pipeline timing reference
- [Dispatcher](../core-concepts/dispatcher) - Message dispatch and routing
