# Implementing Multi-Tenancy

This guide walks through implementing multi-tenancy in a Whizbang application, from basic tenant isolation to advanced group-based sharing.

## Prerequisites

- Whizbang.Core package installed
- Basic understanding of perspectives and lenses
- Familiarity with dependency injection

## Step 1: Configure Security Options

First, configure the security system with roles and permission extraction.

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```csharp
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

```csharp
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

## Testing

Test multi-tenancy with explicit context setup:

```csharp
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

- [Security](../core-concepts/security.md) - Permission and role system
- [Scoping](../core-concepts/scoping.md) - Scope filters and composition
