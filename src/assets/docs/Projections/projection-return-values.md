---
title: Projection Return Values
category: Projections
order: 5
tags: projections, return-values, observability, metrics, monitoring
---

# Projection Return Values

Projection methods can return metadata about the processing outcome using `ProjectionContext.Return()`. This is **metadata only** with **no side effects** - it's purely for observability and metrics.

## ProjectionReturnType Enum

```csharp{
title: "ProjectionReturnType Enum"
description: "Enumeration defining the possible return values for projection methods"
framework: "NET8"
category: "Projections"
difficulty: "BEGINNER"
tags: ["Projections", "Return Values", "Enums"]
filename: "ProjectionReturnType.cs"
usingStatements: ["System"]
showLineNumbers: true
}
public enum ProjectionReturnType {
    Accepted,  // Event was processed successfully (default)
    Ignored    // Event was intentionally ignored/skipped
}
```

## Return Value Semantics

| Return Type | Meaning | Use When | Metrics Impact |
|------------|---------|----------|----------------|
| **Accepted** | Event was processed successfully | Default behavior, projection state updated | Increments `events_processed` counter |
| **Ignored** | Event was intentionally skipped | Filtering, tenant isolation, deduplication | Increments `events_ignored` counter |

## Basic Usage

```csharp{
title: "Basic Projection Return Values"
description: "Using return values to signal projection processing outcomes"
framework: "NET8"
category: "Projections"
difficulty: "BEGINNER"
tags: ["Projections", "Return Values", "Observability"]
nugetPackages: ["Whizbang.Core", "Whizbang.Projections"]
usingStatements: ["System", "System.Threading", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading;
using System.Threading.Tasks;

[WhizbangProjection]
public class OrderProjection {
    // Example 1: Explicit Accepted return (default behavior)
    public async Task OnOrderPlaced(
        [WhizbangSubscribe] OrderPlaced @event,
        ProjectionContext projection,
        CancellationToken ct) {
        await projection.Store.CreateAsync(new OrderSummary {
            OrderId = @event.OrderId,
            Status = "Placed"
        }, ct);

        // Explicitly signal success (optional - this is the default)
        return projection.Return(ProjectionReturnType.Accepted);
    }

    // Example 2: Implicit Accepted (no return statement)
    public async Task OnOrderShipped(
        [WhizbangSubscribe] OrderShipped @event,
        ProjectionContext projection,
        CancellationToken ct) {
        await projection.Store.PatchAsync<OrderSummary>(
            @event.OrderId,
            order => order.Status = "Shipped",
            ct);

        // No explicit return = Accepted (default)
    }

    // Example 3: Ignored return (event intentionally skipped)
    public Task OnOrderEvent(
        [WhizbangSubscribe] OrderEvent @event,
        ProjectionContext projection,
        EventContext eventContext,
        CancellationToken ct) {
        // Only process events for current tenant
        if (eventContext.Security.TenantId != projection.Service.CurrentTenantId) {
            // Different tenant - ignore this event
            return projection.Return(ProjectionReturnType.Ignored);
        }

        // Process the event
        // ...

        return projection.Return(ProjectionReturnType.Accepted);
    }
}

public class OrderSummary {
    public Guid OrderId { get; set; }
    public string Status { get; set; }
}
```

## Common Use Cases for Ignored

### 1. Tenant Isolation

```csharp{
title: "Tenant Isolation with Return Values"
description: "Using Ignored to skip events for different tenants"
framework: "NET8"
category: "Projections"
difficulty: "INTERMEDIATE"
tags: ["Multi-Tenancy", "Filtering", "Return Values"]
nugetPackages: ["Whizbang.Core", "Whizbang.Projections"]
usingStatements: ["System", "System.Threading", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading;
using System.Threading.Tasks;

[WhizbangProjection]
public class TenantOrderProjection {
    private readonly Guid _currentTenantId;

    public TenantOrderProjection(Guid currentTenantId) {
        _currentTenantId = currentTenantId;
    }

    public async Task OnOrderPlaced(
        [WhizbangSubscribe] OrderPlaced @event,
        ProjectionContext projection,
        EventContext eventContext,
        CancellationToken ct) {
        // Skip events for other tenants
        if (eventContext.Security.TenantId != _currentTenantId) {
            return projection.Return(ProjectionReturnType.Ignored);
        }

        // Process event for current tenant
        await projection.Store.CreateAsync(new OrderSummary {
            OrderId = @event.OrderId,
            TenantId = _currentTenantId,
            Status = "Placed"
        }, ct);

        return projection.Return(ProjectionReturnType.Accepted);
    }
}

public class OrderSummary {
    public Guid OrderId { get; set; }
    public Guid TenantId { get; set; }
    public string Status { get; set; }
}
```

### 2. Version Checking and Deduplication

```csharp{
title: "Version Checking and Deduplication"
description: "Using Ignored to skip out-of-order or duplicate events"
framework: "NET8"
category: "Projections"
difficulty: "INTERMEDIATE"
tags: ["Deduplication", "Versioning", "Return Values"]
nugetPackages: ["Whizbang.Core", "Whizbang.Projections"]
usingStatements: ["System", "System.Threading", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading;
using System.Threading.Tasks;

[WhizbangProjection]
public class VersionedOrderProjection {
    public async Task OnOrderUpdated(
        [WhizbangSubscribe] OrderUpdated @event,
        ProjectionContext projection,
        CancellationToken ct) {
        // Get current projection state
        var current = await projection.Store.GetAsync<OrderSummary>(@event.OrderId, ct);

        // Ignore if projection doesn't exist (might be deleted)
        if (current == null) {
            return projection.Return(ProjectionReturnType.Ignored);
        }

        // Ignore if event is older than current state (out-of-order delivery)
        if (@event.Version <= current.Version) {
            return projection.Return(ProjectionReturnType.Ignored);
        }

        // Update the projection
        await projection.Store.UpdateAsync(@event.OrderId, new OrderSummary {
            OrderId = @event.OrderId,
            Version = @event.Version,
            Status = @event.Status
        }, ct);

        return projection.Return(ProjectionReturnType.Accepted);
    }
}

public class OrderSummary {
    public Guid OrderId { get; set; }
    public int Version { get; set; }
    public string Status { get; set; }
}
```

### 3. Event Data Filtering

```csharp{
title: "Event Data Filtering"
description: "Using Ignored to filter based on event flags set by business logic"
framework: "NET8"
category: "Projections"
difficulty: "INTERMEDIATE"
tags: ["Filtering", "Event Data", "Return Values"]
nugetPackages: ["Whizbang.Core", "Whizbang.Projections"]
usingStatements: ["System", "System.Threading", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading;
using System.Threading.Tasks;

[WhizbangProjection]
public class ActiveOrderProjection {
    public async Task OnOrderPlaced(
        [WhizbangSubscribe] OrderPlaced @event,
        ProjectionContext projection,
        CancellationToken ct) {
        // ✅ CORRECT: Business logic already set IsExpired in the event
        // The command handler made this decision, projection just filters
        if (@event.IsExpired) {
            // Event already marked as expired by business logic
            return projection.Return(ProjectionReturnType.Ignored);
        }

        // Process non-expired event
        await projection.Store.CreateAsync(new OrderSummary {
            OrderId = @event.OrderId,
            Status = "Active"
        }, ct);

        return projection.Return(ProjectionReturnType.Accepted);
    }

    public async Task OnOrderStatusChanged(
        [WhizbangSubscribe] OrderStatusChanged @event,
        ProjectionContext projection,
        CancellationToken ct) {
        // Only track "active" status changes
        if (@event.NewStatus != "Active") {
            return projection.Return(ProjectionReturnType.Ignored);
        }

        await projection.Store.PatchAsync<OrderSummary>(
            @event.OrderId,
            order => order.Status = @event.NewStatus,
            ct);

        return projection.Return(ProjectionReturnType.Accepted);
    }
}

public class OrderSummary {
    public Guid OrderId { get; set; }
    public string Status { get; set; }
}
```

### 4. Feature Flag Filtering

```csharp{
title: "Feature Flag Filtering"
description: "Using Ignored to skip events when features are disabled"
framework: "NET8"
category: "Projections"
difficulty: "ADVANCED"
tags: ["Feature Flags", "Configuration", "Return Values"]
nugetPackages: ["Whizbang.Core", "Whizbang.Projections"]
usingStatements: ["System", "System.Threading", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading;
using System.Threading.Tasks;

[WhizbangProjection]
public class NotificationProjection {
    private readonly IFeatureFlagService _featureFlags;

    public NotificationProjection(IFeatureFlagService featureFlags) {
        _featureFlags = featureFlags;
    }

    public async Task OnOrderShipped(
        [WhizbangSubscribe] OrderShipped @event,
        ProjectionContext projection,
        CancellationToken ct) {
        // Skip if shipping notifications are disabled
        // Feature flag is from config, not time-based (deterministic for replay)
        if (!_featureFlags.IsEnabled("ShippingNotifications")) {
            return projection.Return(ProjectionReturnType.Ignored);
        }

        await projection.Store.CreateAsync(new NotificationRecord {
            EventId = @event.OrderId,
            Type = "ShippingNotification",
            CreatedAt = DateTime.UtcNow
        }, ct);

        return projection.Return(ProjectionReturnType.Accepted);
    }
}

public interface IFeatureFlagService {
    bool IsEnabled(string featureName);
}

public class NotificationRecord {
    public Guid EventId { get; set; }
    public string Type { get; set; }
    public DateTime CreatedAt { get; set; }
}
```

### 5. Projection Existence Checking

```csharp{
title: "Projection Existence Checking"
description: "Using Ignored to skip updates to deleted projections"
framework: "NET8"
category: "Projections"
difficulty: "INTERMEDIATE"
tags: ["Existence Checks", "Deleted Projections", "Return Values"]
nugetPackages: ["Whizbang.Core", "Whizbang.Projections"]
usingStatements: ["System", "System.Threading", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading;
using System.Threading.Tasks;

[WhizbangProjection]
public class OrderHistoryProjection {
    public async Task OnOrderUpdated(
        [WhizbangSubscribe] OrderUpdated @event,
        ProjectionContext projection,
        CancellationToken ct) {
        // Check if projection exists
        var existing = await projection.Store.GetAsync<OrderHistory>(@event.OrderId, ct);

        if (existing == null) {
            // Projection was deleted or never created - ignore this update
            return projection.Return(ProjectionReturnType.Ignored);
        }

        // Update existing projection
        await projection.Store.PatchAsync<OrderHistory>(
            @event.OrderId,
            history => history.UpdatedAt = DateTime.UtcNow,
            ct);

        return projection.Return(ProjectionReturnType.Accepted);
    }

    public async Task OnOrderDeleted(
        [WhizbangSubscribe] OrderDeleted @event,
        ProjectionContext projection,
        CancellationToken ct) {
        await projection.Store.DeleteAsync<OrderHistory>(@event.OrderId, ct);
        return projection.Return(ProjectionReturnType.Accepted);
    }
}

public class OrderHistory {
    public Guid OrderId { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

## Important Notes

1. **No Side Effects**: Return values are **metadata only** - they don't affect event flow or projection state
2. **Default is Accepted**: If you don't explicitly return, `Accepted` is assumed
3. **Observability**: Return values are recorded for metrics, logging, and dashboard visualization
4. **No Error Return**: Errors should throw exceptions, not return a status code
5. **Pure Metadata**: Return values don't trigger any framework behavior - they're for observability

## Metrics and Observability

Return values enable rich metrics and dashboards:

```csharp{
title: "Automatic Metrics Tracking"
description: "Example metrics automatically tracked by Whizbang for projection return values"
framework: "NET8"
category: "Projections"
difficulty: "INTERMEDIATE"
tags: ["Metrics", "Observability", "Monitoring"]
filename: "MetricsExample.cs"
usingStatements: ["System"]
showLineNumbers: true
}
// Whizbang automatically tracks these metrics:
// - whizbang_projection_events_accepted{projection="OrderProjection", event="OrderPlaced"}
// - whizbang_projection_events_ignored{projection="OrderProjection", event="OrderPlaced"}
// - whizbang_projection_acceptance_rate{projection="OrderProjection"}
// - whizbang_projection_throughput{projection="OrderProjection"}
```

### Dashboard Visualization

The Whizbang Dashboard uses return values to show:

- **Projection Health**: Acceptance rate over time
- **Event Filtering**: Which events are commonly ignored
- **Tenant Metrics**: Events processed per tenant
- **Performance**: Throughput and latency per projection
- **Debugging**: Identify misconfigured filters

### Example Metrics Query

```promql
# Projection acceptance rate (should be high for normal operations)
sum(rate(whizbang_projection_events_accepted[5m])) by (projection)
/
sum(rate(whizbang_projection_events_total[5m])) by (projection)

# Events ignored by reason (for debugging)
sum(rate(whizbang_projection_events_ignored[5m])) by (projection, reason)

# Tenant-specific processing rate
sum(rate(whizbang_projection_events_accepted[5m])) by (tenant_id)
```

## Best Practices

### 1. Be Explicit When Filtering

```csharp{
title: "Explicit Filtering Best Practice"
description: "Best practices for explicit return value usage vs implicit behavior"
framework: "NET8"
category: "Projections"
difficulty: "BEGINNER"
tags: ["Best Practices", "Return Values", "Explicit Programming"]
filename: "ExplicitFilteringExample.cs"
usingStatements: ["System", "System.Threading", "System.Threading.Tasks"]
showLineNumbers: true
}
// ✅ GOOD - Explicit and clear
if (@event.IsExpired) {
    return projection.Return(ProjectionReturnType.Ignored);
}

// ❌ BAD - Implicit, unclear why event is ignored
if (@event.IsExpired) {
    return Task.CompletedTask;  // Looks like Accepted, but event wasn't processed
}
```

### 2. Use Ignored for Intentional Filtering

```csharp{
title: "Intentional Filtering vs Error Handling"
description: "Correct usage of Ignored for filtering vs incorrect usage for error handling"
framework: "NET8"
category: "Projections"
difficulty: "INTERMEDIATE"
tags: ["Best Practices", "Error Handling", "Filtering"]
filename: "FilteringVsErrorHandling.cs"
usingStatements: ["System", "System.Threading", "System.Threading.Tasks"]
showLineNumbers: true
}
// ✅ GOOD - Intentional filtering (return Ignored)
if (eventContext.Security.TenantId != _currentTenantId) {
    return projection.Return(ProjectionReturnType.Ignored);
}

// ❌ BAD - Errors should throw exceptions, not return Ignored
try {
    await projection.Store.CreateAsync(summary, ct);
} catch (Exception) {
    return projection.Return(ProjectionReturnType.Ignored);  // Wrong! Throw the exception
}
```

### 3. Document Ignored Reasons

```csharp{
title: "Documented Filtering Reasons"
description: "Best practice for documenting why events are ignored with clear comments"
framework: "NET8"
category: "Projections"
difficulty: "BEGINNER"
tags: ["Best Practices", "Documentation", "Code Comments"]
filename: "DocumentedFilteringExample.cs"
usingStatements: ["System", "System.Threading", "System.Threading.Tasks"]
showLineNumbers: true
}
// ✅ GOOD - Comment explains why event is ignored
public Task OnOrderPlaced(
    [WhizbangSubscribe] OrderPlaced @event,
    ProjectionContext projection,
    EventContext eventContext,
    CancellationToken ct) {
    // Ignore events for other tenants - this projection is tenant-scoped
    if (eventContext.Security.TenantId != _currentTenantId) {
        return projection.Return(ProjectionReturnType.Ignored);
    }

    // Process event...
}
```

### 4. Monitor Acceptance Rates

Set up alerts for low acceptance rates:

```yaml
# Prometheus alert rule
- alert: LowProjectionAcceptanceRate
  expr: |
    sum(rate(whizbang_projection_events_accepted[5m])) by (projection)
    /
    sum(rate(whizbang_projection_events_total[5m])) by (projection)
    < 0.5
  for: 10m
  annotations:
    summary: "Projection {{ $labels.projection }} has low acceptance rate"
    description: "Less than 50% of events are being accepted"
```

## Summary

- **Return values are metadata only** - no side effects
- **Default is Accepted** - explicit return is optional
- **Use Ignored for intentional filtering** - tenant isolation, versioning, feature flags
- **Errors should throw exceptions** - not return Ignored
- **Metrics enable observability** - track acceptance rates, throughput, and health
- **Dashboard visualization** - see projection health and filtering patterns

## Next Steps

- [Projection Subscriptions](./projection-subscriptions.md) - Event subscription patterns
- [Projection Contexts](./projection-contexts.md) - EventContext and ProjectionContext injection
- [Projection Purity](./projection-purity.md) - Maintaining pure, deterministic projections
