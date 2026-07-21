---
title: "Implementing Multi-Tenancy"
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - src/Whizbang.Core/Security/RoleBuilder.cs
  - src/Whizbang.Core/Security/ScopeContext.cs
  - src/Whizbang.Core/Security/ScopeContextAccessor.cs
  - src/Whizbang.Core/Security/Exceptions/AccessDeniedException.cs
  - src/Whizbang.Core/Lenses/ScopedLensFactory.cs
  - src/Whizbang.Core/Lenses/InheritScopeAttribute.cs
  - src/Whizbang.Core/IScopeEvent.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveScopeFor.cs
  - src/Whizbang.Core/IMessageContext.cs
testReferences:
  - tests/Whizbang.Core.Tests/Security/RoleBuilderTests.cs
  - tests/Whizbang.Core.Tests/Security/PermissionExtractorTests.cs
  - tests/Whizbang.Core.Tests/Security/ScopeContextTests.cs
  - tests/Whizbang.Core.Tests/Security/AccessDeniedExceptionTests.cs
  - tests/Whizbang.Core.Tests/Lenses/ScopedLensFactoryTests.cs
  - tests/Whizbang.Core.Tests/Scoping/InheritScopeAttributeTests.cs
  - tests/Whizbang.Core.Tests/Scoping/IScopeEventTests.cs
  - tests/Whizbang.Core.Tests/Scoping/IPerspectiveScopeForTests.cs
lastMaintainedCommit: '01f07906'
---

# Implementing Multi-Tenancy

This guide walks through implementing multi-tenancy in a Whizbang application, from basic tenant isolation to advanced group-based sharing.

## Prerequisites

- Whizbang.Core package installed
- Basic understanding of perspectives and lenses
- Familiarity with dependency injection

## Step 1: Configure Security Options

First, configure the security system with roles and permission extraction.

```csharp{title="Step 1: Configure Security Options" description="First, configure the security system with roles and permission extraction." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "C#", "Step", "Configure"] tests=["SecurityOptionsTests.SecurityOptions_FullConfiguration_WorksCorrectlyAsync", "PermissionExtractorTests.SecurityOptions_ExtractorsFromClaims_ProduceCorrectResultsAsync"]}
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

```csharp{title="Step 2: Register Core Services" description="Register the security and scoping services." category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Step", "Register"] unverified="DI registration — service wiring, not asserted by a unit test"}
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

```csharp{title="Step 3: Create Scope Context Middleware" description="Create middleware to populate the scope context from the authenticated user." category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Step", "Create"] unverified="application middleware example — user-authored ASP.NET Core scope-context population, not a Whizbang API under test"}
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

```csharp{title="Step 4: Implement Filterable Lenses" description="Create lenses that implement IFilterableLens to receive scope filters." category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Step", "Implement"] unverified="application lens example — user-authored IFilterableLens implementation, not a Whizbang API under test"}
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

    // Apply scope filters (ScopeFilters is the flags enum)
    if (_filterInfo.Filters.HasFlag(ScopeFilters.Tenant)) {
      query = query.Where(r => r.Scope.TenantId == _filterInfo.TenantId);
    }

    var principalStrings = _filterInfo.SecurityPrincipals.Select(p => (string)p).ToList();

    if (_filterInfo.UseOrLogicForUserAndPrincipal) {
      // User OR Principal (AllowedPrincipals is List<string>)
      query = query.Where(r =>
        r.Scope.UserId == _filterInfo.UserId ||
        r.Scope.AllowedPrincipals.Any(p => principalStrings.Contains(p)));
    } else {
      if (_filterInfo.Filters.HasFlag(ScopeFilters.User)) {
        query = query.Where(r => r.Scope.UserId == _filterInfo.UserId);
      }
      if (_filterInfo.Filters.HasFlag(ScopeFilters.Principal)) {
        query = query.Where(r =>
          r.Scope.AllowedPrincipals.Any(p => principalStrings.Contains(p)));
      }
    }

    return await query.Select(r => r.Model).ToListAsync();
  }

  public async Task<Order?> GetByIdAsync(Guid id) {
    // Similar filtering logic...
  }
}
```

## Step 5: Use in Controllers

Use the scoped lens factory in your controllers.

```csharp{title="Step 5: Use in Controllers" description="Use the scoped lens factory in your controllers." category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Step", "Controllers"] tests=["ScopedLensFactoryTests.IScopedLensFactory_HasGetTenantLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetUserLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetPrincipalLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetMyOrSharedLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetLens_ScopeFilter_Permission_MethodAsync"]}
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
      ScopeFilters.Tenant,
      Permission.Delete("orders"));

    // Will throw AccessDeniedException if not authorized
    // ...
  }
}
```

## Step 6: Store Data with Scope

Perspectives implement a pure `Apply` — the perspective runner persists rows and writes the `scope` column automatically from the message's propagated scope. Declare **which** scope fields a row inherits with `[InheritScope]` on the perspective **model**:

```csharp{title="Step 6: Store Data with Scope" description="Declare scope inheritance on the perspective model; the runner persists scope automatically." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Store"] tests=["InheritScopeAttributeTests.InheritScope_OnCreate_AcceptsCustomFlagsAsync", "InheritScopeAttributeTests.InheritScope_Defaults_AreTenantOnCreate_AndNoneAlwaysAsync"]}
// Owner-style rows: tenant + creating user pinned at INSERT, never mutated after.
[InheritScope(OnCreate = ScopeFields.Tenant | ScopeFields.User)]
public class Order {
  public Guid OrderId { get; init; }
  public string? CustomerId { get; init; }
  // ...
}

public class OrderPerspective : IPerspectiveFor<Order, OrderCreatedEvent> {
  public Order Apply(Order current, OrderCreatedEvent @event) {
    // Pure projection — no store access, no manual scope handling.
    return new Order { OrderId = @event.OrderId, CustomerId = @event.CustomerId };
  }
}
```

Scope inheritance rules at this release:

- **Attribute absent** = `[InheritScope]` defaults: `OnCreate = ScopeFields.Tenant`, `Always = ScopeFields.None`. Only the tenant is copied onto new rows — copying actor identity automatically would conflate audit with access control.
- **`Always = ScopeFields.User`** gives last-writer semantics (the user field tracks the latest writer).
- **Scope is set-once on INSERT** and preserved across updates. To change a row's scope afterwards (e.g. share with groups via `AllowedPrincipals`), publish an event implementing **`IScopeEvent`**, which carries a proposed `PerspectiveScope`.
- A perspective can implement **`IPerspectiveScopeFor<TModel>`** to merge, override, or reject proposed scope changes — it takes precedence over both `[InheritScope]` and `IScopeEvent`.

## Step 7: Handle Access Denied

Handle `AccessDeniedException` appropriately.

```csharp{title="Step 7: Handle Access Denied" description="Handle AccessDeniedException appropriately." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Step", "Handle"] unverified="application middleware example — user-authored AccessDeniedException 403 handler, not a Whizbang API under test"}
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

```csharp{title="Advanced: Organization Hierarchy" description="For organization-based access within a tenant:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Advanced:", "Organization"] unverified="IPerspectiveStore.UpsertAsync with organization scope — store API usage, not covered by this page's scope/lens tests"}
// Store with organization scope (IPerspectiveStore<T>.UpsertAsync overload with scope).
// AllowedPrincipals is List<string>; SecurityPrincipalId converts implicitly.
await _store.UpsertAsync(id, data, new PerspectiveScope {
  TenantId = "tenant-123",
  OrganizationId = "org-sales",
  AllowedPrincipals = [
    SecurityPrincipalId.Group("org:sales"),
    SecurityPrincipalId.Group("org:management")
  ]
});

// Query organization's data
var lens = _lensFactory.GetOrganizationLens<IReportLens>();
```

## Advanced: Department-Based Extensions

Use extensions for custom scope dimensions:

```csharp{title="Advanced: Department-Based Extensions" description="Use extensions for custom scope dimensions:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Advanced:", "Department-Based"] tests=["PerspectiveScopeTests.PerspectiveScope_GetValue_Extension_ReturnsValueAsync"]}
// Store with custom extensions — Extensions is List<ScopeExtension>
// (not a dictionary, for EF Core ComplexProperty().ToJson() compatibility).
// Use SetExtension to add entries:
var scope = new PerspectiveScope { TenantId = "tenant-123" };
scope.SetExtension("department", "engineering");
scope.SetExtension("costCenter", "CC-1234");
scope.SetExtension("project", "alpha");

await _store.UpsertAsync(id, data, scope);

// Access via GetValue (there is no string indexer)
var department = row.Scope.GetValue("department");
```

## Multi-Tenancy in Background Processing

:::new
Background processing tenant support added in v1.0.0
:::

When using lifecycle receptors (`PostPerspectiveDetached`, `PostPerspectiveInline`, etc.) or background workers, HTTP context is unavailable. This section explains how tenant context flows through the system and how to access it.

### Security Context Propagation Flow

Whizbang captures tenant context when a message is dispatched and propagates it through the entire processing pipeline:

```mermaid{caption="Security-context propagation — TenantId captured at the HTTP boundary flows through dispatch, the outbox, the consumer, and perspective processing to a background lifecycle receptor with no manual re-plumbing."}
flowchart TD
    Request["HTTP Request (TenantId from JWT)"]
    Middleware["ScopeContextMiddleware<br/>IScopeContextAccessor.Current<br/>= { TenantId: #quot;tenant-123#quot; }"]
    Dispatch["Command Dispatch<br/>dispatcher.SendAsync(cmd)"]
    Outbox["Outbox (wh_outbox)<br/>hop.Scope (ScopeDelta) carries<br/>TenantId = #quot;tenant-123#quot;"]
    Consumer["ServiceBusConsumerWorker<br/>Merges scope deltas from hops<br/>Establishes IScopeContext"]
    Processing["Perspective Processing<br/>TenantId flows to event"]
    Receptor["PostPerspectiveDetached Receptor<br/>IMessageContext.TenantId<br/>= #quot;tenant-123#quot; ✓"]

    Request --> Middleware
    Middleware --> Dispatch
    Dispatch -->|"TenantId stored in MessageHop"| Outbox
    Outbox -->|"Worker picks up message"| Consumer
    Consumer -->|"Event cascaded"| Processing
    Processing -->|"Lifecycle receptor fires"| Receptor
```

**Key insight**: TenantId is preserved through the entire flow without any manual propagation.

### Accessing Tenant Context in Background Receptors

Choose the access method that fits your needs:

#### Option 1: IMessageContext (Simplest)

For simple tenant access, inject `IMessageContext`:

```csharp{title="Option 1: IMessageContext (Simplest)" description="For simple tenant access, inject IMessageContext:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Option", "IMessageContext"] unverified="application receptor example — user-authored PostPerspectiveDetached handler, not a Whizbang API under test"}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
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

```csharp{title="Option 2: IScopeContextAccessor (Full Scope)" description="For access to roles, permissions, and custom properties:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Option", "IScopeContextAccessor"] unverified="application receptor example — user-authored authorized background handler, not a Whizbang API under test"}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
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

```csharp{title="Option 3: ISecurityContextCallback (Custom Service" description="For integrating with custom services like UserContextManager:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Option", "ISecurityContextCallback"] unverified="application example — user-authored ISecurityContextCallback implementation, not a Whizbang API under test"}
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

```csharp{title="Fallback Pattern for Custom Services" description="If you have a custom service like UserContextManager that reads from HTTP context, implement a fallback pattern:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Fallback", "Pattern"] unverified="application service example — user-authored UserContextManager fallback, not a Whizbang API"}
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

### Explicit Tenant Override with ForTenant()

For system operations that need to target a specific tenant (the older `WithTenant(...)` name was replaced by the explicit tenant-strategy API — `ForTenant(id)` / `ForAllTenants()` / `KeepTenant()`):

```csharp{title="Explicit Tenant Override with ForTenant()" description="For system operations that need to target a specific tenant:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Explicit", "Tenant"] unverified="explicit tenant-strategy API (AsSystem/ForTenant/RunAs) — dispatcher security-context extension, out of scope for this page's scope-filter tests"}
// System job processing for a specific tenant
await dispatcher
  .AsSystem()
  .ForTenant("target-tenant-123")
  .SendAsync(new TenantMaintenanceCommand());

// Admin operation on behalf of a tenant
await dispatcher
  .RunAs("admin@example.com")
  .ForTenant("customer-tenant-id")
  .SendAsync(new DebugCommand());
```

See [Message Security](./message-security.md#explicit-security-context-api) for more details.

## Testing

Test multi-tenancy with explicit context setup:

```csharp{title="Testing" description="Test multi-tenancy with explicit context setup:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Testing"] unverified="application test example — illustrates ScopeContextAccessor/ScopedLensFactory test setup, not a Whizbang API under test"}
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
