---
title: Security
version: 1.0.0
category: Core Concepts
order: 6
description: >-
  Comprehensive security system for Whizbang applications - permissions, roles,
  scope context, security principals, row-level and column-level security,
  data masking, and EF Core integration for principal-based filtering.
tags: 'security, permissions, roles, rbac, abac, scope-context, principals, row-level-security, column-level-security, masking'
---

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

## Roles {#roles}

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

### Role Definition {#role-definition}

The `RoleBuilder` provides a fluent API for defining roles with permissions:

```csharp
public class RoleBuilder {
  public RoleBuilder HasPermission(Permission permission);
  public RoleBuilder HasPermission(string resource, string action);
  public RoleBuilder HasReadPermission(string resource);
  public RoleBuilder HasWritePermission(string resource);
  public RoleBuilder HasDeletePermission(string resource);
  public RoleBuilder HasAdminPermission(string resource);
  public RoleBuilder HasAllPermissions(string resource);  // resource:*
  public Role Build();
}

// Example usage
var role = new RoleBuilder("OrderManager")
  .HasReadPermission("orders")
  .HasWritePermission("orders")
  .HasReadPermission("customers")
  .HasPermission("orders", "export")
  .Build();
```

The `Role` type represents a named collection of permissions:

```csharp
public sealed record Role {
  public required string Name { get; init; }
  public required IReadOnlySet<Permission> Permissions { get; init; }

  public bool HasPermission(Permission permission) {
    return Permissions.Any(p => p.Matches(permission));
  }
}
```

## Security Principals {#security-principals}

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

### JSON Serialization

The `SecurityPrincipalIdJsonConverter` handles JSON serialization of security principal IDs:

```csharp
// Serializes to simple string format
var json = JsonSerializer.Serialize(SecurityPrincipalId.User("alice"));
// Result: "user:alice"

// Deserializes from string
var principal = JsonSerializer.Deserialize<SecurityPrincipalId>("\"group:sales-team\"");
// Result: SecurityPrincipalId { Type = Group, Value = "sales-team" }
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

## Principal Filtering {#principal-filtering}

Whizbang provides three levels of principal-based filtering:

1. **Basic principal checks** - Check if a user belongs to a security principal
2. **EF Core JSONB filtering** - Database-level filtering using PostgreSQL's `?|` operator
3. **Scoped lens integration** - Automatic filtering via `IScopedLensFactory`

See the [Principal Filtering with EF Core](#principal-filtering) section below for implementation details.

## Scope Context {#scope-context}

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

### Scope Context Accessor {#scope-context-accessor}

Access the current scope context via `IScopeContextAccessor`, which uses `AsyncLocal` for request-scoped propagation.

```csharp
public interface IScopeContextAccessor {
  IScopeContext? Current { get; set; }
}

// Usage in a service
public class OrderService {
  private readonly IScopeContextAccessor _accessor;
  private readonly IOrderRepository _repository;

  public OrderService(IScopeContextAccessor accessor, IOrderRepository repository) {
    _accessor = accessor;
    _repository = repository;
  }

  public async Task<Order> GetOrderAsync(string orderId) {
    var context = _accessor.Current
      ?? throw new InvalidOperationException("No scope context available");

    if (!context.HasPermission(Permission.Read("orders"))) {
      throw new AccessDeniedException(
        resourceType: "Order",
        resourceId: orderId,
        requiredPermission: Permission.Read("orders"),
        reason: AccessDenialReason.InsufficientPermissions
      );
    }

    return await _repository.GetByIdAsync(orderId);
  }

  public async Task UpdateOrderAsync(string orderId, UpdateOrderRequest request) {
    var context = _accessor.Current
      ?? throw new InvalidOperationException("No scope context available");

    if (!context.HasPermission(Permission.Write("orders"))) {
      throw new AccessDeniedException(
        resourceType: "Order",
        resourceId: orderId,
        requiredPermission: Permission.Write("orders"),
        reason: AccessDenialReason.InsufficientPermissions
      );
    }

    await _repository.UpdateAsync(orderId, request);
  }
}
```

## Permission Extractors {#extractors}

The `IPermissionExtractor` interface allows custom extraction of permissions from claims, tokens, or other sources.

```csharp
public interface IPermissionExtractor {
  IReadOnlySet<Permission> Extract(IReadOnlyDictionary<string, string> claims);
}

// Built-in claim-based extractor
public class ClaimPermissionExtractor : IPermissionExtractor {
  private readonly string _claimType;
  private readonly char _separator;

  public ClaimPermissionExtractor(string claimType, char separator = ',') {
    _claimType = claimType;
    _separator = separator;
  }

  public IReadOnlySet<Permission> Extract(IReadOnlyDictionary<string, string> claims) {
    if (!claims.TryGetValue(_claimType, out var value)) {
      return new HashSet<Permission>();
    }

    return value
      .Split(_separator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .Select(p => new Permission(p))
      .ToHashSet();
  }
}

// Custom extractor for role-to-permission mapping
public class RolePermissionExtractor : IPermissionExtractor {
  private readonly SecurityOptions _options;

  public RolePermissionExtractor(SecurityOptions options) {
    _options = options;
  }

  public IReadOnlySet<Permission> Extract(IReadOnlyDictionary<string, string> claims) {
    if (!claims.TryGetValue("roles", out var rolesValue)) {
      return new HashSet<Permission>();
    }

    var roleNames = rolesValue.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    var permissions = new HashSet<Permission>();

    foreach (var roleName in roleNames) {
      if (_options.Roles.TryGetValue(roleName, out var role)) {
        foreach (var permission in role.Permissions) {
          permissions.Add(permission);
        }
      }
    }

    return permissions;
  }
}
```

### Registering Extractors

```csharp
services.AddSingleton<IPermissionExtractor>(sp => {
  var options = sp.GetRequiredService<SecurityOptions>();
  return new CompositePermissionExtractor(
    new ClaimPermissionExtractor("permissions"),
    new RolePermissionExtractor(options)
  );
});
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

## Principal Filtering with EF Core {#principal-filtering}

Whizbang provides EF Core integration for principal-based filtering using PostgreSQL's JSONB array overlap operator (`?|`).

### DbContext Configuration

Use `WhizbangDbContextOptionsExtensions` to enable principal filtering:

```csharp
public class OrderDbContext : DbContext {
  protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) {
    optionsBuilder
      .UseNpgsql(connectionString)
      .UseWhizbangJsonFunctions();  // Enable Whizbang JSON functions
  }
}
```

### WhizbangJsonDbFunctions

The `WhizbangJsonDbFunctions` static class provides EF Core-translatable methods for JSONB operations:

```csharp
public static class WhizbangJsonDbFunctions {
  /// <summary>
  /// Checks if a JSONB array contains any of the specified values.
  /// Translates to PostgreSQL: jsonb_column ?| array['value1', 'value2']
  /// </summary>
  public static bool JsonArrayContainsAny(string[] column, string[] values);
}
```

### Query Translation

The `WhizbangMethodCallTranslatorPlugin` and `JsonArrayContainsAnyTranslator` handle translation of LINQ queries to PostgreSQL:

```csharp
// LINQ query
var orders = await dbContext.Orders
  .Where(o => WhizbangJsonDbFunctions.JsonArrayContainsAny(
    o.AllowedPrincipals,
    currentUserPrincipals
  ))
  .ToListAsync();

// Translates to SQL:
// SELECT * FROM orders WHERE allowed_principals ?| ARRAY['user:alice', 'group:sales-team']
```

### Principal Filter Example

```csharp
public class OrderRepository {
  private readonly OrderDbContext _dbContext;
  private readonly IScopeContextAccessor _scopeAccessor;

  public async Task<List<Order>> GetAccessibleOrdersAsync() {
    var context = _scopeAccessor.Current!;
    var principalIds = context.SecurityPrincipals
      .Select(p => p.ToString())
      .ToArray();

    return await _dbContext.Orders
      .Where(o => o.TenantId == context.Scope.TenantId)
      .Where(o => WhizbangJsonDbFunctions.JsonArrayContainsAny(
        o.AllowedPrincipals,
        principalIds
      ))
      .ToListAsync();
  }
}
```

## Row-Level Security {#row-level-security}

Row-level security restricts which rows a user can access based on their identity, roles, or group memberships.

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

### Order Example

A complete example showing row-level security for orders:

```csharp
public class Order {
  public required string OrderId { get; init; }
  public required string TenantId { get; init; }
  public required string CustomerId { get; init; }
  public required string CreatedByUserId { get; init; }
  public required decimal TotalAmount { get; init; }
  public required OrderStatus Status { get; init; }

  // Row-level security: which principals can access this order
  public required string[] AllowedPrincipals { get; init; }
}

public class OrderService {
  private readonly IScopedLensFactory _lensFactory;

  public async Task<Order?> GetOrderAsync(string orderId) {
    // Returns null if user doesn't have access
    var lens = _lensFactory.GetPrincipalLens<IOrderLens>(
      Permission.Read("orders")
    );

    return await lens.Query()
      .Where(o => o.OrderId == orderId)
      .FirstOrDefaultAsync();
  }

  public async Task<Order> CreateOrderAsync(CreateOrderRequest request) {
    var context = _lensFactory.ScopeContext;
    var lens = _lensFactory.GetTenantLens<IOrderLens>(
      Permission.Write("orders")
    );

    var order = new Order {
      OrderId = Guid.NewGuid().ToString(),
      TenantId = context.Scope.TenantId!,
      CustomerId = request.CustomerId,
      CreatedByUserId = context.Scope.UserId!,
      TotalAmount = request.TotalAmount,
      Status = OrderStatus.Pending,
      // Grant access to creator and their team
      AllowedPrincipals = new[] {
        $"user:{context.Scope.UserId}",
        "group:order-processors",
        "group:managers"
      }
    };

    await lens.InsertAsync(order);
    return order;
  }
}
```

## Column-Level Security {#column-level-security}

Column-level security restricts which fields a user can view based on their permissions.

### Customer Example

A complete example showing column-level security for customer data:

```csharp
public class Customer {
  public required string CustomerId { get; init; }
  public required string TenantId { get; init; }
  public required string Name { get; init; }
  public required string Email { get; init; }

  // Sensitive fields - require specific permissions to view
  public string? PhoneNumber { get; init; }
  public string? SocialSecurityNumber { get; init; }
  public string? CreditCardLast4 { get; init; }
  public decimal? CreditLimit { get; init; }
}

public class CustomerDto {
  public required string CustomerId { get; init; }
  public required string Name { get; init; }
  public required string Email { get; init; }

  // Only populated if user has customers:read-pii permission
  public string? PhoneNumber { get; init; }
  public string? SocialSecurityNumber { get; init; }
  public string? CreditCardLast4 { get; init; }

  // Only populated if user has customers:read-financial permission
  public decimal? CreditLimit { get; init; }
}

public class CustomerService {
  private readonly IScopedLensFactory _lensFactory;

  public async Task<CustomerDto?> GetCustomerAsync(string customerId) {
    var lens = _lensFactory.GetTenantLens<ICustomerLens>(
      Permission.Read("customers")
    );

    var customer = await lens.Query()
      .Where(c => c.CustomerId == customerId)
      .FirstOrDefaultAsync();

    if (customer is null) {
      return null;
    }

    var context = _lensFactory.ScopeContext;
    var canReadPii = context.HasPermission(new Permission("customers:read-pii"));
    var canReadFinancial = context.HasPermission(new Permission("customers:read-financial"));

    return new CustomerDto {
      CustomerId = customer.CustomerId,
      Name = customer.Name,
      Email = customer.Email,
      // Column-level security: only include sensitive fields if permitted
      PhoneNumber = canReadPii ? customer.PhoneNumber : null,
      SocialSecurityNumber = canReadPii ? customer.SocialSecurityNumber : null,
      CreditCardLast4 = canReadPii ? customer.CreditCardLast4 : null,
      CreditLimit = canReadFinancial ? customer.CreditLimit : null
    };
  }
}
```

## Data Masking {#masking-strategies}

The `MaskingStrategy` enum defines strategies for masking sensitive data in responses.

```csharp
public enum MaskingStrategy {
  /// <summary>No masking - return full value (requires permission)</summary>
  None,

  /// <summary>Completely hide the value (return null)</summary>
  Hide,

  /// <summary>Show only last 4 characters (e.g., "****1234")</summary>
  Last4,

  /// <summary>Show only first character (e.g., "J***")</summary>
  FirstChar,

  /// <summary>Show redacted placeholder (e.g., "[REDACTED]")</summary>
  Redacted,

  /// <summary>Custom masking function</summary>
  Custom
}

public static class DataMasker {
  public static string? Mask(string? value, MaskingStrategy strategy) {
    if (value is null) {
      return null;
    }

    return strategy switch {
      MaskingStrategy.None => value,
      MaskingStrategy.Hide => null,
      MaskingStrategy.Last4 => value.Length > 4
        ? new string('*', value.Length - 4) + value[^4..]
        : new string('*', value.Length),
      MaskingStrategy.FirstChar => value.Length > 0
        ? value[0] + new string('*', value.Length - 1)
        : value,
      MaskingStrategy.Redacted => "[REDACTED]",
      _ => throw new ArgumentOutOfRangeException(nameof(strategy))
    };
  }
}
```

### Using Masking with Column Security

```csharp
public class CustomerDto {
  public required string CustomerId { get; init; }
  public required string Name { get; init; }
  public required string Email { get; init; }
  public string? PhoneNumber { get; init; }
  public string? SocialSecurityNumberMasked { get; init; }
  public string? CreditCardMasked { get; init; }
}

public CustomerDto ToDto(Customer customer, IScopeContext context) {
  var canReadPii = context.HasPermission(new Permission("customers:read-pii"));

  return new CustomerDto {
    CustomerId = customer.CustomerId,
    Name = customer.Name,
    Email = customer.Email,
    PhoneNumber = canReadPii
      ? customer.PhoneNumber
      : DataMasker.Mask(customer.PhoneNumber, MaskingStrategy.Last4),
    SocialSecurityNumberMasked = canReadPii
      ? customer.SocialSecurityNumber
      : DataMasker.Mask(customer.SocialSecurityNumber, MaskingStrategy.Last4),
    CreditCardMasked = DataMasker.Mask(customer.CreditCardLast4, MaskingStrategy.Last4)
  };
}
```

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

## Exceptions {#exceptions}

### AccessDeniedException

Thrown when a security check fails due to insufficient permissions.

```csharp
public class AccessDeniedException : Exception {
  public required string ResourceType { get; init; }
  public string? ResourceId { get; init; }
  public required Permission RequiredPermission { get; init; }
  public required AccessDenialReason Reason { get; init; }

  public AccessDeniedException(
    string resourceType,
    string? resourceId,
    Permission requiredPermission,
    AccessDenialReason reason
  ) : base($"Access denied to {resourceType}" +
           (resourceId is not null ? $" ({resourceId})" : "") +
           $": requires {requiredPermission}") {
    ResourceType = resourceType;
    ResourceId = resourceId;
    RequiredPermission = requiredPermission;
    Reason = reason;
  }
}

public enum AccessDenialReason {
  InsufficientPermissions,
  InsufficientRoles,
  NotInPrincipalGroup,
  ScopeViolation,
  ResourceNotFound
}
```

### Exception Handling

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

## Related Documentation

- [Scoping](./scoping.md) - Scope system overview
- [System Events](./system-events.md) - Audit and monitoring events
- [Implementing Multi-Tenancy](../guides/implementing-multi-tenancy.md) - End-to-end guide
- [Security Best Practices](../advanced-topics/security.md) - Authentication, authorization, encryption
