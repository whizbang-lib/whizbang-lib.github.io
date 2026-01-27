# Security System

Whizbang provides a comprehensive security system supporting RBAC (Role-Based Access Control) and ABAC (Attribute-Based Access Control) patterns with composable scope filters, permission checks, and security event auditing.

## Overview

The security system consists of:

- **Permissions** - Type-safe permission identifiers with wildcard matching
- **Roles** - Named collections of permissions
- **Scope Context** - Ambient security context for current operation
- **Security Principals** - Users, groups, and services with hierarchical membership
- **Scoped Lens Factory** - Permission-aware lens resolution with composable filters
- **System Events** - Security audit trail (AccessDenied, AccessGranted, etc.)

## Permissions

Permissions use a `resource:action` pattern and support wildcard matching.

```csharp
// Factory methods for common patterns
var readOrders = Permission.Read("orders");      // "orders:read"
var writeOrders = Permission.Write("orders");    // "orders:write"
var deleteOrders = Permission.Delete("orders");  // "orders:delete"
var adminOrders = Permission.Admin("orders");    // "orders:admin"
var allOrders = Permission.All("orders");        // "orders:*"

// Custom permissions
var permission = new Permission("orders:export");

// Wildcard matching
var allResources = new Permission("*:*");        // Matches everything
var allOrderActions = Permission.All("orders");  // Matches orders:*
```

### Wildcard Rules

| Permission | Matches |
|------------|---------|
| `orders:read` | Exactly `orders:read` |
| `orders:*` | Any action on orders (`orders:read`, `orders:write`, etc.) |
| `*:read` | Read on any resource (`orders:read`, `customers:read`, etc.) |
| `*:*` | Everything (super-admin) |

## Roles

Roles are named collections of permissions, defined via fluent configuration.

```csharp
var options = new SecurityOptions()
  .DefineRole("Admin", b => b
    .HasAllPermissions("*"))              // Super-admin
  .DefineRole("Manager", b => b
    .HasAllPermissions("orders")          // orders:*
    .HasReadPermission("reports")         // reports:read
    .HasWritePermission("schedules"))     // schedules:write
  .DefineRole("User", b => b
    .HasReadPermission("orders")          // orders:read
    .HasReadPermission("products"));      // products:read

// Check role permissions
var managerRole = options.Roles["Manager"];
managerRole.HasPermission(Permission.Delete("orders"));  // true (orders:*)
managerRole.HasPermission(Permission.Read("reports"));   // true
managerRole.HasPermission(Permission.Delete("reports")); // false
```

## Security Principals

Security principals identify users, groups, and services with type prefixes for clarity.

```csharp
// Factory methods
var user = SecurityPrincipalId.User("alice");           // "user:alice"
var group = SecurityPrincipalId.Group("sales-team");    // "group:sales-team"
var service = SecurityPrincipalId.Service("api-gateway"); // "svc:api-gateway"
var app = SecurityPrincipalId.Application("mobile-app"); // "app:mobile-app"

// Type checks
user.IsUser;     // true
group.IsGroup;   // true
service.IsService; // true
```

### Nested Group Support

Security principals support hierarchical group membership. When a user belongs to a group that's nested within another group, all memberships are pre-flattened in the scope context.

```csharp
// Alice is in "sales-team" which is in "all-employees"
var context = new ScopeContext {
  SecurityPrincipals = new HashSet<SecurityPrincipalId> {
    SecurityPrincipalId.User("alice"),
    SecurityPrincipalId.Group("sales-team"),
    SecurityPrincipalId.Group("all-employees")  // Inherited from sales-team
  }
  // ...
};
```

## Scope Context

`IScopeContext` is the ambient security context for the current operation, populated from JWT claims, message headers, or explicit injection.

```csharp
public interface IScopeContext {
  PerspectiveScope Scope { get; }           // TenantId, UserId, etc.
  IReadOnlySet<string> Roles { get; }
  IReadOnlySet<Permission> Permissions { get; }
  IReadOnlySet<SecurityPrincipalId> SecurityPrincipals { get; }
  IReadOnlyDictionary<string, string> Claims { get; }

  // Helper methods
  bool HasPermission(Permission permission);
  bool HasAnyPermission(params Permission[] permissions);
  bool HasAllPermissions(params Permission[] permissions);
  bool HasRole(string roleName);
  bool HasAnyRole(params string[] roleNames);
  bool IsMemberOfAny(params SecurityPrincipalId[] principals);
}
```

### Creating Scope Context

```csharp
var context = new ScopeContext {
  Scope = new PerspectiveScope {
    TenantId = "tenant-123",
    UserId = "user-456",
    OrganizationId = "org-789"
  },
  Roles = new HashSet<string> { "Admin", "Support" },
  Permissions = new HashSet<Permission> {
    Permission.All("orders"),
    Permission.Read("customers")
  },
  SecurityPrincipals = new HashSet<SecurityPrincipalId> {
    SecurityPrincipalId.User("user-456"),
    SecurityPrincipalId.Group("support-team")
  },
  Claims = new Dictionary<string, string> {
    ["sub"] = "user-456",
    ["tenant"] = "tenant-123"
  }
};
```

### Scope Context Accessor

Access the current scope context via `IScopeContextAccessor`, which uses `AsyncLocal` for request-scoped propagation.

```csharp
public interface IScopeContextAccessor {
  IScopeContext? Current { get; set; }
}

// Usage in a service
public class OrderService {
  private readonly IScopeContextAccessor _accessor;

  public void Process() {
    var context = _accessor.Current;
    if (context?.HasPermission(Permission.Write("orders")) != true) {
      throw new AccessDeniedException(...);
    }
  }
}
```

## Scoped Lens Factory

`IScopedLensFactory` provides permission-aware lens resolution with composable scope filters.

### Composable Scope Filters

```csharp
[Flags]
public enum ScopeFilter {
  None = 0,           // No filtering (admin access)
  Tenant = 1 << 0,    // Filter by TenantId
  Organization = 1 << 1,
  Customer = 1 << 2,
  User = 1 << 3,      // Filter by UserId
  Principal = 1 << 4  // Filter by security principal membership
}
```

### Filter Combinations

Filters are combined with bitwise OR and applied as AND conditions (except User+Principal which uses OR).

```csharp
// Tenant only
var lens = factory.GetLens<IOrderLens>(ScopeFilter.Tenant);
// WHERE TenantId = ?

// Tenant + User
var lens = factory.GetLens<IOrderLens>(ScopeFilter.Tenant | ScopeFilter.User);
// WHERE TenantId = ? AND UserId = ?

// Tenant + Principal (group-based access)
var lens = factory.GetLens<IOrderLens>(ScopeFilter.Tenant | ScopeFilter.Principal);
// WHERE TenantId = ? AND AllowedPrincipals ?| [caller's principals]

// My records OR shared with me
var lens = factory.GetMyOrSharedLens<IOrderLens>();
// WHERE TenantId = ? AND (UserId = ? OR AllowedPrincipals ?| [...])
```

### Convenience Methods

```csharp
// No filtering (admin)
factory.GetGlobalLens<IOrderLens>();

// Tenant-scoped
factory.GetTenantLens<IOrderLens>();

// Tenant + User
factory.GetUserLens<IOrderLens>();

// Tenant + Organization
factory.GetOrganizationLens<IOrderLens>();

// Tenant + Principal
factory.GetPrincipalLens<IOrderLens>();

// My records OR shared with me
factory.GetMyOrSharedLens<IOrderLens>();
```

### Permission Checks

The factory can enforce permission checks before returning a lens.

```csharp
// Single permission required
var lens = factory.GetLens<IOrderLens>(
  ScopeFilter.Tenant,
  Permission.Read("orders"));

// Any of these permissions
var lens = factory.GetLens<IOrderLens>(
  ScopeFilter.Tenant,
  Permission.Read("orders"),
  Permission.Write("orders"));
```

If permissions are not satisfied, `AccessDeniedException` is thrown and an `AccessDenied` system event is emitted.

## Perspective Scope

`PerspectiveScope` stores scope metadata on perspective rows, separate from the data model.

```csharp
public record PerspectiveScope {
  public string? TenantId { get; init; }
  public string? CustomerId { get; init; }
  public string? UserId { get; init; }
  public string? OrganizationId { get; init; }

  // Security principals that have access to this record
  public IReadOnlyList<SecurityPrincipalId>? AllowedPrincipals { get; init; }

  // Custom extension properties
  public IReadOnlyDictionary<string, string?>? Extensions { get; init; }

  // Unified access via indexer
  public string? this[string key] => key switch {
    nameof(TenantId) => TenantId,
    nameof(UserId) => UserId,
    // ... falls back to Extensions
  };
}
```

### Row-Level Security via AllowedPrincipals

Records can specify which security principals have access:

```csharp
var row = new PerspectiveRow<Order> {
  Data = order,
  Scope = new PerspectiveScope {
    TenantId = "tenant-123",
    AllowedPrincipals = new List<SecurityPrincipalId> {
      SecurityPrincipalId.User("creator-456"),
      SecurityPrincipalId.Group("sales-team"),
      SecurityPrincipalId.Group("managers")
    }
  }
};
```

When querying with `ScopeFilter.Principal`, records are returned where the caller's security principals overlap with `AllowedPrincipals`.

## Security System Events

The security system emits events for auditing.

### AccessDenied

Emitted when access is denied due to insufficient permissions.

```csharp
public sealed record AccessDenied : ISystemEvent {
  public required string ResourceType { get; init; }
  public string? ResourceId { get; init; }
  public required Permission RequiredPermission { get; init; }
  public required IReadOnlySet<Permission> CallerPermissions { get; init; }
  public required IReadOnlySet<string> CallerRoles { get; init; }
  public required PerspectiveScope Scope { get; init; }
  public required AccessDenialReason Reason { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
}
```

### AccessGranted

Emitted when access to a sensitive resource is granted (optional, for audit trails).

```csharp
public sealed record AccessGranted : ISystemEvent {
  public required string ResourceType { get; init; }
  public string? ResourceId { get; init; }
  public required Permission UsedPermission { get; init; }
  public required ScopeFilter AccessFilter { get; init; }
  public required PerspectiveScope Scope { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
}
```

## Configuration

### Registering Security Services

```csharp
services.AddSingleton<IScopeContextAccessor, ScopeContextAccessor>();
services.AddSingleton<ISystemEventEmitter, SystemEventEmitter>();
services.AddSingleton<LensOptions>();
services.AddScoped<IScopedLensFactory, ScopedLensFactory>();

// Configure security options
services.AddSingleton(new SecurityOptions()
  .DefineRole("Admin", b => b.HasAllPermissions("*"))
  .DefineRole("User", b => b.HasReadPermission("orders"))
  .ExtractPermissionsFromClaim("permissions")
  .ExtractRolesFromClaim("roles")
  .ExtractSecurityPrincipalsFromClaim("groups"));
```

### Extracting from JWT Claims

```csharp
var options = new SecurityOptions()
  .ExtractPermissionsFromClaim("permissions")  // "orders:read, orders:write"
  .ExtractRolesFromClaim("roles")              // "Admin, Support"
  .ExtractSecurityPrincipalsFromClaim("groups"); // "group:sales, group:managers"
```

## Marker Interfaces

Optional marker interfaces for models that include scope in their data:

```csharp
public interface ITenantScoped {
  string TenantId { get; }
}

public interface IUserScoped : ITenantScoped {
  string UserId { get; }
}

public interface IOrganizationScoped : ITenantScoped {
  string OrganizationId { get; }
}

public interface ICustomerScoped : ITenantScoped {
  string CustomerId { get; }
}
```

## Exception Handling

```csharp
try {
  var lens = factory.GetLens<IOrderLens>(
    ScopeFilter.Tenant,
    Permission.Delete("orders"));
} catch (AccessDeniedException ex) {
  // ex.RequiredPermission - What was needed
  // ex.ResourceType - What was being accessed
  // ex.ResourceId - Optional specific resource
  // ex.Reason - Why access was denied
  logger.LogWarning(
    "Access denied: {Resource} requires {Permission}",
    ex.ResourceType,
    ex.RequiredPermission);
}
```

## Related Documentation

- [Scoping](./scoping.md) - Scope system overview
- [System Events](./system-events.md) - Audit and monitoring events
- [Implementing Multi-Tenancy](../guides/implementing-multi-tenancy.md) - End-to-end guide
