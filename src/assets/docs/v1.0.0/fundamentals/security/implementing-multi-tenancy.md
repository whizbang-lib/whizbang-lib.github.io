---
title: "Implementing Multi-Tenancy"
version: 1.0.0
category: "Core Concepts"
order: 9
description: >-
  Step-by-step guide to implementing multi-tenancy in Whizbang applications,
  covering tenant isolation, role-based security options, scope filters, and
  group-based sharing patterns.
tags: 'multi-tenancy, tenant-isolation, security-options, scope-filters, rbac, saas, data-isolation'
codeReferences:
  - src/Whizbang.Core/Security/SecurityOptions.cs
  - src/Whizbang.Core/Security/IPermissionExtractor.cs
---

# Implementing Multi-Tenancy

This guide walks through implementing multi-tenancy in a Whizbang application, from basic tenant isolation to advanced group-based sharing.

## Prerequisites

- Whizbang.Core package installed
- Basic understanding of perspectives and lenses
- Familiarity with dependency injection

## Step 1: Configure Security Options

First, configure the security system with roles and permission extraction.

```csharp{title="Step 1: Configure Security Options" description="First, configure the security system with roles and permission extraction." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "C#", "Step", "Configure"]}
// Program.cs
builder.Services.AddSingleton(new SecurityOptions()
  // Define roles with permissions
  .DefineRole("Admin", b => b
    .HasAllPermissions("*"))
  .DefineRole("Manager", b => b
    .HasAllPermissions("orders")
    .HasAllPermissions("customers")
    .HasReadPermission("reports"))
  .DefineRole("User", b => b
    .HasReadPermission("orders")
    .HasReadPermission("products"))

  // Extract from JWT claims
  .ExtractPermissionsFromClaim("permissions")
  .ExtractRolesFromClaim("roles")
  .ExtractSecurityPrincipalsFromClaim("groups"));
```

## Step 2: Register Core Services

Register the security and scoping services.

```csharp{title="Step 2: Register Core Services" description="Register the security and scoping services." category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Step", "Register"]}
// Core services
builder.Services.AddSingleton<IScopeContextAccessor, ScopeContextAccessor>();
builder.Services.AddSingleton<ISystemEventEmitter, SystemEventEmitter>();
builder.Services.AddSingleton<LensOptions>();

// Scoped lens factory
builder.Services.AddScoped<IScopedLensFactory, ScopedLensFactory>();

// Your lenses
builder.Services.AddScoped<IOrderLens, OrderLens>();
builder.Services.AddScoped<ICustomerLens, CustomerLens>();
```

## Step 3: Create Scope Context Middleware

Create middleware to populate the scope context from the authenticated user.

```csharp{title="Step 3: Create Scope Context Middleware" description="Create middleware to populate the scope context from the authenticated user." category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Step", "Create"]}
public class ScopeContextMiddleware {
  private readonly RequestDelegate _next;
  private readonly SecurityOptions _securityOptions;

  public ScopeContextMiddleware(RequestDelegate next, SecurityOptions options) {
    _next = next;
    _securityOptions = options;
  }

  public async Task InvokeAsync(
      HttpContext httpContext,
      IScopeContextAccessor accessor) {

    if (httpContext.User.Identity?.IsAuthenticated == true) {
      var claims = httpContext.User.Claims
        .ToDictionary(c => c.Type, c => c.Value);

      // Extract using configured extractors
      var permissions = _securityOptions.Extractors
        .SelectMany(e => e.ExtractPermissions(claims))
        .ToHashSet();
      var roles = _securityOptions.Extractors
        .SelectMany(e => e.ExtractRoles(claims))
        .ToHashSet();
      var principals = _securityOptions.Extractors
        .SelectMany(e => e.ExtractSecurityPrincipals(claims))
        .ToHashSet();

      // Add user as principal
      var userId = claims.GetValueOrDefault("sub");
      if (userId != null) {
        principals.Add(SecurityPrincipalId.User(userId));
      }

      accessor.Current = new ScopeContext {
        Scope = new PerspectiveScope {
          TenantId = claims.GetValueOrDefault("tenant"),
          UserId = userId
        },
        Roles = roles,
        Permissions = permissions,
        SecurityPrincipals = principals,
        Claims = claims
      };
    }

    await _next(httpContext);
  }
}

// Register in Program.cs
app.UseAuthentication();
app.UseMiddleware<ScopeContextMiddleware>();
app.UseAuthorization();
```

## Step 4: Implement Filterable Lenses

Create lenses that implement `IFilterableLens` to receive scope filters.

```csharp{title="Step 4: Implement Filterable Lenses" description="Create lenses that implement IFilterableLens to receive scope filters." category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Step", "Implement"]}
public interface IOrderLens : ILensQuery, IFilterableLens {
  Task<List<Order>> GetAllAsync();
  Task<Order?> GetByIdAsync(Guid id);
}

public class OrderLens : IOrderLens {
  private readonly DbContext _context;
  private ScopeFilterInfo _filterInfo;

  public OrderLens(DbContext context) {
    _context = context;
  }

  public void ApplyFilter(ScopeFilterInfo filterInfo) {
    _filterInfo = filterInfo;
  }

  public async Task<List<Order>> GetAllAsync() {
    var query = _context.Set<PerspectiveRow<Order>>().AsQueryable();

    // Apply scope filters
    if (_filterInfo.Filters.HasFlag(ScopeFilter.Tenant)) {
      query = query.Where(r => r.Scope.TenantId == _filterInfo.TenantId);
    }

    if (_filterInfo.UseOrLogicForUserAndPrincipal) {
      // User OR Principal
      query = query.Where(r =>
        r.Scope.UserId == _filterInfo.UserId ||
        r.Scope.AllowedPrincipals!.Any(p =>
          _filterInfo.SecurityPrincipals.Contains(p)));
    } else {
      if (_filterInfo.Filters.HasFlag(ScopeFilter.User)) {
        query = query.Where(r => r.Scope.UserId == _filterInfo.UserId);
      }
      if (_filterInfo.Filters.HasFlag(ScopeFilter.Principal)) {
        query = query.Where(r =>
          r.Scope.AllowedPrincipals!.Any(p =>
            _filterInfo.SecurityPrincipals.Contains(p)));
      }
    }

    return await query.Select(r => r.Data).ToListAsync();
  }

  public async Task<Order?> GetByIdAsync(Guid id) {
    // Similar filtering logic...
  }
}
```

## Step 5: Use in Controllers

Use the scoped lens factory in your controllers.

```csharp{title="Step 5: Use in Controllers" description="Use the scoped lens factory in your controllers." category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Step", "Controllers"]}
[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase {
  private readonly IScopedLensFactory _lensFactory;

  public OrdersController(IScopedLensFactory lensFactory) {
    _lensFactory = lensFactory;
  }

  [HttpGet]
  public async Task<IActionResult> GetOrders() {
    // Gets only orders for current tenant
    var lens = _lensFactory.GetTenantLens<IOrderLens>();
    var orders = await lens.GetAllAsync();
    return Ok(orders);
  }

  [HttpGet("my")]
  public async Task<IActionResult> GetMyOrders() {
    // Gets only current user's orders
    var lens = _lensFactory.GetUserLens<IOrderLens>();
    var orders = await lens.GetAllAsync();
    return Ok(orders);
  }

  [HttpGet("shared")]
  public async Task<IActionResult> GetSharedOrders() {
    // Gets orders shared with user's groups
    var lens = _lensFactory.GetPrincipalLens<IOrderLens>();
    var orders = await lens.GetAllAsync();
    return Ok(orders);
  }

  [HttpGet("all-accessible")]
  public async Task<IActionResult> GetAllAccessibleOrders() {
    // Gets my orders + shared with me
    var lens = _lensFactory.GetMyOrSharedLens<IOrderLens>();
    var orders = await lens.GetAllAsync();
    return Ok(orders);
  }

  [HttpDelete("{id}")]
  public async Task<IActionResult> DeleteOrder(Guid id) {
    // Require delete permission
    var lens = _lensFactory.GetLens<IOrderLens>(
      ScopeFilter.Tenant,
      Permission.Delete("orders"));

    // Will throw AccessDeniedException if not authorized
    // ...
  }
}
```

## Step 6: Store Data with Scope

When creating perspective rows, set the appropriate scope.

```csharp{title="Step 6: Store Data with Scope" description="When creating perspective rows, set the appropriate scope." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Store"]}
public class OrderPerspective : IPerspectiveFor<Order, OrderCreatedEvent> {
  private readonly IPerspectiveStore<Order> _store;
  private readonly IScopeContextAccessor _accessor;

  public async Task Update(OrderCreatedEvent @event, CancellationToken ct) {
    var context = _accessor.Current!;
    var order = Apply(new Order(), @event);

    await _store.UpsertAsync(
      @event.OrderId,
      order,
      new PerspectiveScope {
        TenantId = context.Scope.TenantId,
        UserId = context.Scope.UserId,
        // Optional: Allow sharing with user's groups
        AllowedPrincipals = context.SecurityPrincipals.ToList()
      },
      ct);
  }
}
```

## Step 7: Handle Access Denied

Handle `AccessDeniedException` appropriately.

```csharp{title="Step 7: Handle Access Denied" description="Handle AccessDeniedException appropriately." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Handle"]}
public class SecurityExceptionMiddleware {
  private readonly RequestDelegate _next;
  private readonly ILogger<SecurityExceptionMiddleware> _logger;

  public async Task InvokeAsync(HttpContext context) {
    try {
      await _next(context);
    } catch (AccessDeniedException ex) {
      _logger.LogWarning(
        "Access denied: {Resource} requires {Permission}. Reason: {Reason}",
        ex.ResourceType,
        ex.RequiredPermission,
        ex.Reason);

      context.Response.StatusCode = 403;
      await context.Response.WriteAsJsonAsync(new {
        error = "Access denied",
        resource = ex.ResourceType,
        requiredPermission = ex.RequiredPermission.Value
      });
    }
  }
}
```

## Advanced: Organization Hierarchy

For organization-based access within a tenant:

```csharp{title="Advanced: Organization Hierarchy" description="For organization-based access within a tenant:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Advanced:", "Organization"]}
// Store with organization scope
await _store.UpsertAsync(id, data, new PerspectiveScope {
  TenantId = "tenant-123",
  OrganizationId = "org-sales",
  AllowedPrincipals = new[] {
    SecurityPrincipalId.Group("org:sales"),
    SecurityPrincipalId.Group("org:management")
  }
});

// Query organization's data
var lens = _lensFactory.GetOrganizationLens<IReportLens>();
```

## Advanced: Department-Based Extensions

Use extensions for custom scope dimensions:

```csharp{title="Advanced: Department-Based Extensions" description="Use extensions for custom scope dimensions:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Advanced:", "Department-Based"]}
// Store with custom extensions
await _store.UpsertAsync(id, data, new PerspectiveScope {
  TenantId = "tenant-123",
  Extensions = new Dictionary<string, string?> {
    ["department"] = "engineering",
    ["costCenter"] = "CC-1234",
    ["project"] = "alpha"
  }
});

// Access in queries
var department = row.Scope["department"];
```

## Multi-Tenancy in Background Processing

:::new
Background processing tenant support added in v1.0.0
:::

When using lifecycle receptors (`PostPerspectiveAsync`, etc.) or background workers, HTTP context is unavailable. This section explains how tenant context flows through the system and how to access it.

### Security Context Propagation Flow

Whizbang captures tenant context when a message is dispatched and propagates it through the entire processing pipeline:

```
HTTP Request (TenantId from JWT)
         │
         ▼
┌────────────────────────────────┐
│ ScopeContextMiddleware         │
│ IScopeContextAccessor.Current  │
│ = { TenantId: "tenant-123" }   │
└────────────────┬───────────────┘
                 │
                 ▼
┌────────────────────────────────┐
│ Command Dispatch               │
│ dispatcher.SendAsync(cmd)      │
└────────────────┬───────────────┘
                 │
                 ▼ TenantId stored in MessageHop
┌────────────────────────────────┐
│ Outbox (wh_outbox)             │
│ hop.SecurityContext.TenantId   │
│ = "tenant-123"                 │
└────────────────┬───────────────┘
                 │
                 ▼ Worker picks up message
┌────────────────────────────────┐
│ ServiceBusConsumerWorker       │
│ Extracts TenantId from hop     │
│ Establishes IScopeContext      │
└────────────────┬───────────────┘
                 │
                 ▼ Event cascaded
┌────────────────────────────────┐
│ Perspective Processing         │
│ TenantId flows to event        │
└────────────────┬───────────────┘
                 │
                 ▼ Lifecycle receptor fires
┌────────────────────────────────┐
│ PostPerspectiveAsync Receptor  │
│ IMessageContext.TenantId       │
│ = "tenant-123" ✓               │
└────────────────────────────────┘
```

**Key insight**: TenantId is preserved through the entire flow without any manual propagation.

### Accessing Tenant Context in Background Receptors

Choose the access method that fits your needs:

#### Option 1: IMessageContext (Simplest)

For simple tenant access, inject `IMessageContext`:

```csharp{title="Option 1: IMessageContext (Simplest)" description="For simple tenant access, inject IMessageContext:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Option", "IMessageContext"]}
[FireAt(LifecycleStage.PostPerspectiveAsync)]
public class TenantAwareBackgroundHandler : IReceptor<OrderCreatedEvent> {
  private readonly IMessageContext _messageContext;
  private readonly ITenantDbFactory _dbFactory;

  public TenantAwareBackgroundHandler(
      IMessageContext messageContext,
      ITenantDbFactory dbFactory) {
    _messageContext = messageContext;
    _dbFactory = dbFactory;
  }

  public async ValueTask HandleAsync(OrderCreatedEvent evt, CancellationToken ct) {
    // TenantId is available even though HTTP context is gone!
    var tenantId = _messageContext.TenantId;

    if (string.IsNullOrEmpty(tenantId)) {
      // Handle system messages without tenant context
      return;
    }

    // Use tenant-specific database
    using var db = _dbFactory.CreateForTenant(tenantId);
    await db.NotifyTenantAsync(evt.OrderId, ct);
  }
}
```

#### Option 2: IScopeContextAccessor (Full Scope)

For access to roles, permissions, and custom properties:

```csharp{title="Option 2: IScopeContextAccessor (Full Scope)" description="For access to roles, permissions, and custom properties:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Option", "IScopeContextAccessor"]}
[FireAt(LifecycleStage.PostPerspectiveAsync)]
public class AuthorizedBackgroundHandler : IReceptor<SensitiveEvent> {
  private readonly IScopeContextAccessor _scopeContextAccessor;

  public AuthorizedBackgroundHandler(IScopeContextAccessor scopeContextAccessor) {
    _scopeContextAccessor = scopeContextAccessor;
  }

  public async ValueTask HandleAsync(SensitiveEvent evt, CancellationToken ct) {
    var scope = _scopeContextAccessor.Current?.Scope;

    var tenantId = scope?.TenantId;
    var userId = scope?.UserId;
    var roles = _scopeContextAccessor.Current?.Roles;

    // Full security context available for authorization checks
    if (roles?.Contains("Admin") != true) {
      return; // Skip non-admin processing
    }

    // Process with full context...
  }
}
```

#### Option 3: ISecurityContextCallback (Custom Service Integration)

For integrating with custom services like `UserContextManager`:

```csharp{title="Option 3: ISecurityContextCallback (Custom Service" description="For integrating with custom services like UserContextManager:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Option", "ISecurityContextCallback"]}
public class UserContextManagerCallback : ISecurityContextCallback {
  private readonly UserContextManager _userContextManager;

  public UserContextManagerCallback(UserContextManager userContextManager) {
    _userContextManager = userContextManager;
  }

  public ValueTask OnContextEstablishedAsync(
    IScopeContext context,
    IMessageEnvelope envelope,
    IServiceProvider scopedProvider,
    CancellationToken cancellationToken = default) {

    // Populate UserContextManager BEFORE receptors run
    if (context?.Scope != null) {
      _userContextManager.SetTenantContext(
        new TenantContext { TenantId = context.Scope.TenantId });
      _userContextManager.SetUserContext(
        new UserContext { UserId = context.Scope.UserId });
    }

    return ValueTask.CompletedTask;
  }
}

// Register
services.AddScoped<ISecurityContextCallback, UserContextManagerCallback>();
```

### Pattern Decision Guide

| Scenario | Recommended Approach |
|----------|---------------------|
| Simple TenantId access | **IMessageContext** |
| Need roles or permissions | **IScopeContextAccessor** |
| Custom `UserContextManager` service | **ISecurityContextCallback** |
| Stateless receptor | **IMessageContext** |
| Legacy service integration | **ISecurityContextCallback** |
| Tenant-specific database connection | **IMessageContext** or **IScopeContextAccessor** |

### Fallback Pattern for Custom Services

If you have a custom service like `UserContextManager` that reads from HTTP context, implement a fallback pattern:

```csharp{title="Fallback Pattern for Custom Services" description="If you have a custom service like UserContextManager that reads from HTTP context, implement a fallback pattern:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Fallback", "Pattern"]}
public class UserContextManager {
  private readonly IHttpContextAccessor _httpContextAccessor;
  private readonly IScopeContextAccessor _scopeContextAccessor;

  public UserContextManager(
      IHttpContextAccessor httpContextAccessor,
      IScopeContextAccessor scopeContextAccessor) {
    _httpContextAccessor = httpContextAccessor;
    _scopeContextAccessor = scopeContextAccessor;
  }

  public string? TenantId {
    get {
      // Priority 1: HTTP context (API requests)
      var httpTenantId = GetTenantFromHttpContext();
      if (!string.IsNullOrEmpty(httpTenantId)) {
        return httpTenantId;
      }

      // Priority 2: Whizbang scope context (background processing)
      return _scopeContextAccessor.Current?.Scope.TenantId;
    }
  }

  private string? GetTenantFromHttpContext() {
    return _httpContextAccessor.HttpContext?
      .User.FindFirstValue("tenant");
  }
}
```

This pattern allows the same service to work in both HTTP and background contexts.

### Explicit Tenant Override with WithTenant()

For system operations that need to target a specific tenant:

```csharp{title="Explicit Tenant Override with WithTenant()" description="For system operations that need to target a specific tenant:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Explicit", "Tenant"]}
// System job processing for a specific tenant
await dispatcher
  .AsSystem()
  .WithTenant("target-tenant-123")
  .SendAsync(new TenantMaintenanceCommand());

// Admin operation on behalf of a tenant
await dispatcher
  .RunAs("admin@example.com")
  .WithTenant("customer-tenant-id")
  .SendAsync(new DebugCommand());
```

See [Message Security](./message-security.md#explicit-security-context-api) for more details.

## Testing

Test multi-tenancy with explicit context setup:

```csharp{title="Testing" description="Test multi-tenancy with explicit context setup:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Testing"]}
[Test]
public async Task GetOrders_ReturnsOnlyTenantOrders() {
  // Arrange
  var accessor = new ScopeContextAccessor();
  accessor.Current = new ScopeContext {
    Scope = new PerspectiveScope { TenantId = "tenant-A" },
    Roles = new HashSet<string>(),
    Permissions = new HashSet<Permission> { Permission.Read("orders") },
    SecurityPrincipals = new HashSet<SecurityPrincipalId>(),
    Claims = new Dictionary<string, string>()
  };

  var factory = new ScopedLensFactory(provider, accessor, options, emitter);

  // Act
  var lens = factory.GetTenantLens<IOrderLens>();
  var orders = await lens.GetAllAsync();

  // Assert
  await Assert.That(orders.All(o => o.TenantId == "tenant-A")).IsTrue();
}
```

## Related Documentation

- [Security](./security.md) - Permission and role system
- [Scoping](./scoping.md) - Scope filters and composition
