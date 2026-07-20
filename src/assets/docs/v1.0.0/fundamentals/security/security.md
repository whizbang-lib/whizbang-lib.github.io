---
title: Security
pageType: overview
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Core Concepts
order: 6
description: >-
  Comprehensive security system for Whizbang applications - permissions, roles,
  scope context, security principals, row-level and column-level security,
  data masking, and EF Core integration for principal-based filtering.
tags: 'security, permissions, roles, rbac, abac, scope-context, principals, row-level-security, column-level-security, masking'
codeReferences:
  - src/Whizbang.Core/Security/IScopeContext.cs
  - src/Whizbang.Core/Security/ScopeContext.cs
  - src/Whizbang.Core/Security/IScopeContextAccessor.cs
  - src/Whizbang.Core/Security/Role.cs
  - src/Whizbang.Core/Security/RoleBuilder.cs
  - src/Whizbang.Core/Security/Permission.cs
  - src/Whizbang.Core/Security/SecurityPrincipalId.cs
  - src/Whizbang.Core/Security/SecurityOptions.cs
  - src/Whizbang.Core/Security/IPermissionExtractor.cs
  - src/Whizbang.Core/Security/Attributes/ScopedAttribute.cs
  - src/Whizbang.Core/Security/Attributes/FieldPermissionAttribute.cs
  - src/Whizbang.Core/Security/Exceptions/AccessDeniedException.cs
  - src/Whizbang.Core/Lenses/IScopedLensFactory.cs
  - src/Whizbang.Core/Lenses/ScopeFilter.cs
  - src/Whizbang.Core/Lenses/PerspectiveScope.cs
  - src/Whizbang.Core/SystemEvents/Security/AccessDenied.cs
  - src/Whizbang.Core/SystemEvents/Security/AccessGranted.cs
  - src/Whizbang.Data.EFCore.Postgres/Functions/WhizbangJsonDbFunctions.cs
  - src/Whizbang.Data.EFCore.Postgres/Functions/WhizbangDbContextOptionsExtensions.cs
testReferences:
  - tests/Whizbang.Core.Tests/Security/PermissionTests.cs
  - tests/Whizbang.Core.Tests/Security/RoleTests.cs
  - tests/Whizbang.Core.Tests/Security/RoleBuilderTests.cs
  - tests/Whizbang.Core.Tests/Security/SecurityPrincipalIdTests.cs
  - tests/Whizbang.Core.Tests/Security/SecurityPrincipalIdJsonConverterTests.cs
  - tests/Whizbang.Core.Tests/Security/ScopeContextTests.cs
  - tests/Whizbang.Core.Tests/Security/ScopeContextAccessorTests.cs
  - tests/Whizbang.Core.Tests/Security/PermissionExtractorTests.cs
  - tests/Whizbang.Core.Tests/Security/AccessDeniedExceptionTests.cs
  - tests/Whizbang.Core.Tests/Security/SecurityAttributeTests.cs
  - tests/Whizbang.Core.Tests/Lenses/ScopedLensFactoryTests.cs
  - tests/Whizbang.Core.Tests/Lenses/ScopeFilterTests.cs
lastMaintainedCommit: '01f07906'
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

```csharp{title="Permissions" description="Permissions use a resource:action pattern and support wildcard matching." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Permissions"] tests=["PermissionTests.Permission_Read_CreatesCorrectPermissionAsync", "PermissionTests.Permission_Write_CreatesCorrectPermissionAsync", "PermissionTests.Permission_Delete_CreatesCorrectPermissionAsync", "PermissionTests.Permission_Admin_CreatesCorrectPermissionAsync", "PermissionTests.Permission_All_CreatesWildcardPermissionAsync", "PermissionTests.Permission_Constructor_ValidValue_CreatesInstanceAsync"]}
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

```csharp{title="Roles" description="Roles are named collections of permissions, defined via fluent configuration." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Roles"] tests=["SecurityOptionsTests.SecurityOptions_DefineRole_AddsRoleAsync", "SecurityOptionsTests.SecurityOptions_FullConfiguration_WorksCorrectlyAsync", "SecurityOptionsTests.SecurityOptions_DefineMultipleRoles_AllAddedAsync"]}
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

```csharp{title="Role Definition" description="The RoleBuilder provides a fluent API for defining roles with permissions:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Role", "Definition"] tests=["RoleBuilderTests.RoleBuilder_Chaining_BuildsCompleteRoleAsync", "RoleBuilderTests.RoleBuilder_HasPermission_String_AddsPermissionAsync", "RoleBuilderTests.RoleBuilder_HasReadPermission_AddsReadPermissionAsync", "RoleBuilderTests.RoleBuilder_HasWritePermission_AddsWritePermissionAsync"]}
public sealed class RoleBuilder(string name) {
  public RoleBuilder HasPermission(Permission permission);
  public RoleBuilder HasPermission(string permission);    // "resource:action"
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
  .HasPermission("orders:export")
  .Build();
```

The `Role` type represents a named collection of permissions:

```csharp{title="Role Definition - Role" description="The Role type represents a named collection of permissions:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Role", "Definition"] tests=["RoleTests.Role_HasPermission_WithMatchingPermission_ReturnsTrueAsync", "RoleTests.Role_HasPermission_WithWildcardPermission_ReturnsTrueAsync", "RoleTests.Role_Name_ReturnsConfiguredNameAsync", "RoleTests.Role_Permissions_ReturnsConfiguredPermissionsAsync"]}
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

```csharp{title="Security Principals" description="Security principals identify users, groups, and services with type prefixes for clarity." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Principals", "Security-principals"] tests=["SecurityPrincipalIdTests.SecurityPrincipalId_User_HasCorrectPrefixAsync", "SecurityPrincipalIdTests.SecurityPrincipalId_Group_HasCorrectPrefixAsync", "SecurityPrincipalIdTests.SecurityPrincipalId_Service_HasCorrectPrefixAsync", "SecurityPrincipalIdTests.SecurityPrincipalId_Application_HasCorrectPrefixAsync", "SecurityPrincipalIdTests.SecurityPrincipalId_IsUser_ReturnsTrueForUserPrefixAsync", "SecurityPrincipalIdTests.SecurityPrincipalId_IsGroup_ReturnsTrueForGroupPrefixAsync", "SecurityPrincipalIdTests.SecurityPrincipalId_IsService_ReturnsTrueForServicePrefixAsync"]}
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

```csharp{title="JSON Serialization" description="The SecurityPrincipalIdJsonConverter handles JSON serialization of security principal IDs:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "JSON", "Serialization"] tests=["SecurityPrincipalIdJsonConverterTests.Serialize_SecurityPrincipalId_WritesAsStringAsync", "SecurityPrincipalIdJsonConverterTests.Deserialize_StringValue_ReturnsSecurityPrincipalIdAsync"]}
// Serializes to simple string format
var json = JsonSerializer.Serialize(SecurityPrincipalId.User("alice"));
// Result: "user:alice"

// Deserializes from string
var principal = JsonSerializer.Deserialize<SecurityPrincipalId>("\"group:sales-team\"");
// Result: SecurityPrincipalId { Type = Group, Value = "sales-team" }
```

### Nested Group Support

Security principals support hierarchical group membership. When a user belongs to a group that's nested within another group, all memberships are pre-flattened in the scope context.

```csharp{title="Nested Group Support" description="Security principals support hierarchical group membership." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Nested", "Group"] tests=["ScopeContextTests.ScopeContext_IsMemberOfAll_WithAllMatching_ReturnsTrueAsync", "SecurityPrincipalIdTests.SecurityPrincipalId_InHashSet_SupportsContainsCheckAsync"]}
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

```csharp{title="Scope Context" description="IScopeContext is the ambient security context for the current operation, populated from JWT claims, message headers, or" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Scope", "Context"] tests=["ScopeContextTests.ScopeContext_HasPermission_WithExactMatch_ReturnsTrueAsync", "ScopeContextTests.ScopeContext_HasAnyPermission_WithOneMatch_ReturnsTrueAsync", "ScopeContextTests.ScopeContext_HasAllPermissions_WithAllMatching_ReturnsTrueAsync", "ScopeContextTests.ScopeContext_HasRole_WithMatch_ReturnsTrueAsync", "ScopeContextTests.ScopeContext_HasAnyRole_WithOneMatch_ReturnsTrueAsync", "ScopeContextTests.ScopeContext_IsMemberOfAny_WithMatchingPrincipal_ReturnsTrueAsync", "ScopeContextTests.ScopeContext_IsMemberOfAll_WithAllMatching_ReturnsTrueAsync"]}
public interface IScopeContext {
  PerspectiveScope Scope { get; }           // TenantId, UserId, etc.
  IReadOnlySet<string> Roles { get; }
  IReadOnlySet<Permission> Permissions { get; }
  IReadOnlySet<SecurityPrincipalId> SecurityPrincipals { get; }
  IReadOnlyDictionary<string, string> Claims { get; }
  string? ActualPrincipal { get; }          // Who is really acting (RunAs scenarios)
  string? EffectivePrincipal { get; }       // Who the action is performed as
  SecurityContextType ContextType { get; }  // User, System, Service, ...

  // Helper methods
  bool HasPermission(Permission permission);
  bool HasAnyPermission(params Permission[] permissions);
  bool HasAllPermissions(params Permission[] permissions);
  bool HasRole(string roleName);
  bool HasAnyRole(params string[] roleNames);
  bool IsMemberOfAny(params SecurityPrincipalId[] principals);
  bool IsMemberOfAll(params SecurityPrincipalId[] principals);
}
```

### Creating Scope Context

```csharp{title="Creating Scope Context" description="Creating Scope Context" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Creating", "Scope"] tests=["ScopeContextTests.ScopeContext_HasPermission_WithExactMatch_ReturnsTrueAsync", "ScopeContextTests.ScopeContext_HasRole_WithMatch_ReturnsTrueAsync"]}
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

```csharp{title="Scope Context Accessor" description="Access the current scope context via IScopeContextAccessor, which uses AsyncLocal for request-scoped propagation." category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Scope", "Context"] tests=["ScopeContextAccessorTests.ScopeContextAccessor_Current_AfterSet_ReturnsContextAsync", "ScopeContextAccessorTests.ScopeContextAccessor_Current_InitiallyNull_ReturnsNullAsync", "ScopeContextAccessorTests.ScopeContextAccessor_Current_AcrossAsyncCalls_PropagatesAsync"]}
public interface IScopeContextAccessor {
  IScopeContext? Current { get; set; }

  // The message context that initiated the current operation (correlation/causation)
  IMessageContext? InitiatingContext { get; set; }

  // Convenience accessors
  string? UserId => InitiatingContext?.UserId;
  string? TenantId => InitiatingContext?.TenantId;
  IScopeContext? ScopeContext => Current;
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
        requiredPermission: Permission.Read("orders"),
        resourceType: "Order",
        resourceId: orderId,
        reason: AccessDenialReason.InsufficientPermission
      );
    }

    return await _repository.GetByIdAsync(orderId);
  }

  public async Task UpdateOrderAsync(string orderId, UpdateOrderRequest request) {
    var context = _accessor.Current
      ?? throw new InvalidOperationException("No scope context available");

    if (!context.HasPermission(Permission.Write("orders"))) {
      throw new AccessDeniedException(
        requiredPermission: Permission.Write("orders"),
        resourceType: "Order",
        resourceId: orderId,
        reason: AccessDenialReason.InsufficientPermission
      );
    }

    await _repository.UpdateAsync(orderId, request);
  }
}
```

## Permission Extractors {#extractors}

The `IPermissionExtractor` interface allows custom extraction of permissions, roles, and security principals from claims, tokens, or other sources.

```csharp{title="Permission Extractors" description="The IPermissionExtractor interface allows custom extraction of permissions, roles, and security principals from claims:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Permission", "Extractors"]}
public interface IPermissionExtractor {
  IEnumerable<Permission> ExtractPermissions(IReadOnlyDictionary<string, string> claims);
  IEnumerable<string> ExtractRoles(IReadOnlyDictionary<string, string> claims);
  IEnumerable<SecurityPrincipalId> ExtractSecurityPrincipals(IReadOnlyDictionary<string, string> claims);
}

// Custom extractor for role-to-permission mapping
public class RolePermissionExtractor : IPermissionExtractor {
  private readonly SecurityOptions _options;

  public RolePermissionExtractor(SecurityOptions options) {
    _options = options;
  }

  public IEnumerable<Permission> ExtractPermissions(IReadOnlyDictionary<string, string> claims) {
    if (!claims.TryGetValue("roles", out var rolesValue)) {
      yield break;
    }

    var roleNames = rolesValue.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    foreach (var roleName in roleNames) {
      if (_options.Roles.TryGetValue(roleName, out var role)) {
        foreach (var permission in role.Permissions) {
          yield return permission;
        }
      }
    }
  }

  public IEnumerable<string> ExtractRoles(IReadOnlyDictionary<string, string> claims) => [];

  public IEnumerable<SecurityPrincipalId> ExtractSecurityPrincipals(IReadOnlyDictionary<string, string> claims) => [];
}
```

### Registering Extractors

Built-in claim-based extraction and custom extractors are registered through `SecurityOptions`:

```csharp{title="Registering Extractors" description="Registering Extractors" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Registering", "Extractors"] tests=["SecurityOptionsTests.SecurityOptions_ExtractMultipleClaims_AllExtractorsAddedAsync", "PermissionExtractorTests.SecurityOptions_ExtractPermissionsFrom_AddsCustomExtractorAsync"]}
var options = new SecurityOptions()
  // Built-in claim-based extraction (comma-separated claim values)
  .ExtractPermissionsFromClaim("permissions")
  .ExtractRolesFromClaim("roles")
  .ExtractSecurityPrincipalsFromClaim("groups")
  // Custom extractor
  .ExtractPermissionsFrom(new RolePermissionExtractor(securityOptions));
```

## Scoped Lens Factory

`IScopedLensFactory` provides permission-aware lens resolution with composable scope filters.

### Composable Scope Filters

```csharp{title="Composable Scope Filters" description="Composable Scope Filters" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Composable", "Scope"] tests=["ScopeFilterTests.ScopeFilter_None_HasZeroValueAsync", "ScopeFilterTests.ScopeFilter_Tenant_HasCorrectValueAsync", "ScopeFilterTests.ScopeFilter_Organization_HasCorrectValueAsync", "ScopeFilterTests.ScopeFilter_Customer_HasCorrectValueAsync", "ScopeFilterTests.ScopeFilter_User_HasCorrectValueAsync", "ScopeFilterTests.ScopeFilter_Principal_HasCorrectValueAsync"]}
[Flags]
public enum ScopeFilters {
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

```csharp{title="Filter Combinations" description="Filters are combined with bitwise OR and applied as AND conditions (except User+Principal which uses OR)." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Filter", "Combinations"] tests=["ScopeFilterTests.ScopeFilter_CombinedFlags_CanBeOrTogetherAsync", "ScopeFilterTests.ScopeFilter_HasFlag_DetectsIndividualFlagsAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetLens_ScopeFilter_MethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetMyOrSharedLensMethodAsync"]}
// Tenant only
var lens = factory.GetLens<IOrderLens>(ScopeFilters.Tenant);
// WHERE TenantId = ?

// Tenant + User
var lens = factory.GetLens<IOrderLens>(ScopeFilters.Tenant | ScopeFilters.User);
// WHERE TenantId = ? AND UserId = ?

// Tenant + Principal (group-based access)
var lens = factory.GetLens<IOrderLens>(ScopeFilters.Tenant | ScopeFilters.Principal);
// WHERE TenantId = ? AND AllowedPrincipals ?| [caller's principals]

// My records OR shared with me
var lens = factory.GetMyOrSharedLens<IOrderLens>();
// WHERE TenantId = ? AND (UserId = ? OR AllowedPrincipals ?| [...])
```

### Convenience Methods

```csharp{title="Convenience Methods" description="Convenience Methods" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Convenience", "Methods"] tests=["ScopedLensFactoryTests.IScopedLensFactory_HasGetGlobalLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetTenantLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetUserLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetOrganizationLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetCustomerLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetPrincipalLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetMyOrSharedLensMethodAsync"]}
// No filtering (admin)
factory.GetGlobalLens<IOrderLens>();

// Tenant-scoped
factory.GetTenantLens<IOrderLens>();

// Tenant + User
factory.GetUserLens<IOrderLens>();

// Tenant + Organization
factory.GetOrganizationLens<IOrderLens>();

// Tenant + Customer
factory.GetCustomerLens<IOrderLens>();

// Tenant + Principal
factory.GetPrincipalLens<IOrderLens>();

// My records OR shared with me (Tenant + User + Principal)
factory.GetMyOrSharedLens<IOrderLens>();
```

### Permission Checks

The factory can enforce permission checks before returning a lens.

```csharp{title="Permission Checks" description="The factory can enforce permission checks before returning a lens." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Permission", "Checks"] tests=["ScopedLensFactoryTests.IScopedLensFactory_HasGetLens_ScopeFilter_Permission_MethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetLens_ScopeFilter_PermissionArray_MethodAsync"]}
// Single permission required
var lens = factory.GetLens<IOrderLens>(
  ScopeFilters.Tenant,
  Permission.Read("orders"));

// Any of these permissions
var lens = factory.GetLens<IOrderLens>(
  ScopeFilters.Tenant,
  Permission.Read("orders"),
  Permission.Write("orders"));
```

If permissions are not satisfied, `AccessDeniedException` is thrown and an `AccessDenied` system event is emitted.

## Principal Filtering with EF Core {#principal-filtering}

Whizbang provides EF Core integration for principal-based filtering using PostgreSQL's JSONB array overlap operator (`?|`).

### DbContext Configuration

Use `WhizbangDbContextOptionsExtensions.UseWhizbangFunctions()` (on the Npgsql options builder) to enable principal filtering:

```csharp{title="DbContext Configuration" description="Use UseWhizbangFunctions to enable principal filtering:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "DbContext", "Configuration"] unverified="EF Core Postgres DbContext wiring (EFCore.Postgres); outside Core security unit-test scope"}
public class OrderDbContext : DbContext {
  protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) {
    optionsBuilder.UseNpgsql(connectionString, npgsqlOptions => {
      npgsqlOptions.UseWhizbangFunctions();  // Enable Whizbang function translators
    });
  }
}
```

### WhizbangJsonDbFunctions

The `WhizbangJsonDbFunctions` static class provides an EF Core-translatable method for JSONB principal checks:

```csharp{title="WhizbangJsonDbFunctions" description="The WhizbangJsonDbFunctions static class provides an EF Core-translatable method for JSONB principal checks:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "WhizbangJsonDbFunctions"] unverified="EF Core query-translation marker (EFCore.Postgres); exercised via SQL translation, not a Core unit test"}
public static class WhizbangJsonDbFunctions {
  /// <summary>
  /// Checks if a row scope's AllowedPrincipals JSONB array contains any of the
  /// specified values. Translates to PostgreSQL:
  /// scope->'AllowedPrincipals' ?| array['value1', 'value2']
  /// Only valid inside EF Core LINQ queries.
  /// </summary>
  public static bool AllowedPrincipalsContainsAny(
      this DbFunctions _,
      PerspectiveScope scope,
      string[] values);
}
```

### Query Translation

The `WhizbangMethodCallTranslatorPlugin` and `JsonArrayContainsAnyTranslator` handle translation of LINQ queries to PostgreSQL:

```csharp{title="Query Translation" description="The WhizbangMethodCallTranslatorPlugin and JsonArrayContainsAnyTranslator handle translation of LINQ queries to" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Query", "Translation"] unverified="LINQ-to-SQL translation (EFCore.Postgres); needs Postgres integration, not a Core unit test"}
// LINQ query over perspective rows
var orders = await dbContext.Set<PerspectiveRow<Order>>()
  .Where(row => EF.Functions.AllowedPrincipalsContainsAny(
    row.Scope,
    currentUserPrincipals
  ))
  .ToListAsync();

// Translates to SQL using PostgreSQL's JSONB array-overlap operator:
// ... WHERE scope->'AllowedPrincipals' ?| ARRAY['user:alice', 'group:sales-team']
```

### Principal Filter Example

```csharp{title="Principal Filter Example" description="Principal Filter Example" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Principal", "Filter"] unverified="EF Core repository example (EFCore.Postgres); needs Postgres integration, not a Core unit test"}
public class OrderRepository {
  private readonly OrderDbContext _dbContext;
  private readonly IScopeContextAccessor _scopeAccessor;

  public async Task<List<PerspectiveRow<Order>>> GetAccessibleOrdersAsync() {
    var context = _scopeAccessor.Current!;
    var principalIds = context.SecurityPrincipals
      .Select(p => p.ToString())
      .ToArray();

    return await _dbContext.Set<PerspectiveRow<Order>>()
      .Where(row => row.Scope.TenantId == context.Scope.TenantId)
      .Where(row => EF.Functions.AllowedPrincipalsContainsAny(
        row.Scope,
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

```csharp{title="Row-Level Security via AllowedPrincipals" description="Records can specify which security principals have access:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Row-Level", "AllowedPrincipals"] tests=["PerspectiveScopeTests.PerspectiveScope_AllowedPrincipals_StoresPrincipalsAsync", "SecurityPrincipalIdTests.SecurityPrincipalId_ImplicitToString_ReturnsValueAsync"]}
// PerspectiveScope.AllowedPrincipals is a List<string>;
// SecurityPrincipalId converts implicitly to string
var scope = new PerspectiveScope {
  TenantId = "tenant-123",
  AllowedPrincipals = [
    SecurityPrincipalId.User("creator-456"),
    SecurityPrincipalId.Group("sales-team"),
    SecurityPrincipalId.Group("managers")
  ]
};
```

When querying with `ScopeFilters.Principal`, records are returned where the caller's security principals overlap with the row scope's `AllowedPrincipals`.

### Order Example

A complete example showing row-level security for orders:

```csharp{title="Order Example" description="A complete example showing row-level security for orders:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Order", "Example"]}
public class Order {
  public required Guid OrderId { get; init; }
  public required string CustomerId { get; init; }
  public required string CreatedByUserId { get; init; }
  public required decimal TotalAmount { get; init; }
  public required OrderStatus Status { get; init; }
}

public class OrderService {
  private readonly IScopedLensFactory _lensFactory;

  public OrderService(IScopedLensFactory lensFactory) {
    _lensFactory = lensFactory;
  }

  public async Task<Order?> GetOrderAsync(Guid orderId) {
    // Throws AccessDeniedException if the caller lacks orders:read;
    // rows the caller's principals can't access are filtered out
    var lens = _lensFactory.GetLens<IOrderLens>(
      ScopeFilters.Tenant | ScopeFilters.Principal,
      Permission.Read("orders")
    );

    var row = await lens.Query
      .Where(r => r.Data.OrderId == orderId)
      .FirstOrDefaultAsync();

    return row?.Data;
  }
}
```

Row-level access (`AllowedPrincipals`) is stamped on the row's `PerspectiveScope` when the perspective persists the model — writes flow through commands and events, not through the lens. See [Scoping](./scoping.md) for how scope is captured and inherited.

```csharp{title="Order Example - Row Scope" description="AllowedPrincipals live on the row scope, not the data model:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Order", "Example"] tests=["PerspectiveScopeTests.PerspectiveScope_AllowedPrincipals_StoresPrincipalsAsync", "PerspectiveScopeTests.PerspectiveScope_TenantId_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_UserId_ReturnsValueAsync"]}
// Tenant/user identifiers and AllowedPrincipals ride on the row's scope
var scope = new PerspectiveScope {
  TenantId = "tenant-123",
  UserId = "user-456",
  AllowedPrincipals = [
    "user:user-456",          // creator
    "group:order-processors", // their team
    "group:managers"
  ]
};
```

## Column-Level Security {#column-level-security}

Column-level security restricts which fields a user can view based on their permissions.

### Customer Example

A complete example showing column-level security for customer data:

```csharp{title="Customer Example" description="A complete example showing column-level security for customer data:" category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Customer", "Example"]}
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
  private readonly IScopeContextAccessor _scopeAccessor;

  public CustomerService(IScopedLensFactory lensFactory, IScopeContextAccessor scopeAccessor) {
    _lensFactory = lensFactory;
    _scopeAccessor = scopeAccessor;
  }

  public async Task<CustomerDto?> GetCustomerAsync(string customerId) {
    var lens = _lensFactory.GetLens<ICustomerLens>(
      ScopeFilters.Tenant,
      Permission.Read("customers")
    );

    var row = await lens.Query
      .Where(r => r.Data.CustomerId == customerId)
      .FirstOrDefaultAsync();

    if (row is null) {
      return null;
    }

    var customer = row.Data;
    var context = _scopeAccessor.Current!;
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

The `MaskingStrategy` enum (paired with the `[FieldPermission]` attribute) defines strategies for masking sensitive fields when the caller lacks the required permission.

```csharp{title="Data Masking" description="MaskingStrategy and the FieldPermission attribute define how sensitive fields are masked." category="Best-Practices" difficulty="ADVANCED" tags=["Fundamentals", "Security", "Data", "Masking"]}
public enum MaskingStrategy {
  /// <summary>Completely hide the value (return null/default)</summary>
  Hide = 0,

  /// <summary>Return "****" placeholder</summary>
  Mask = 1,

  /// <summary>Return partial value like "****1234" (last 4 characters visible)</summary>
  Partial = 2,

  /// <summary>Return "[REDACTED]" placeholder</summary>
  Redact = 3
}

// Declare the permission a field requires and how to mask it when denied
[AttributeUsage(AttributeTargets.Property, AllowMultiple = false)]
public sealed class FieldPermissionAttribute(
    string permission,
    MaskingStrategy masking = MaskingStrategy.Hide) : Attribute {
  public Permission Permission { get; }
  public MaskingStrategy Masking { get; }
}
```

### Using Masking with Column Security

```csharp{title="Using Masking with Column Security" description="Using Masking with Column Security" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "C#", "Using", "Masking"]}
public class Customer {
  public required string CustomerId { get; init; }
  public required string Name { get; init; }
  public required string Email { get; init; }

  // Requires customers:read-pii; hidden entirely when denied
  [FieldPermission("customers:read-pii", MaskingStrategy.Hide)]
  public string? SocialSecurityNumber { get; init; }

  // Requires customers:read-pii; partially masked when denied ("****1234")
  [FieldPermission("customers:read-pii", MaskingStrategy.Partial)]
  public string? PhoneNumber { get; init; }

  // Requires customers:read-financial; placeholder when denied
  [FieldPermission("customers:read-financial", MaskingStrategy.Redact)]
  public string? CreditCardLast4 { get; init; }
}
```

## Perspective Scope

`PerspectiveScope` stores scope metadata on perspective rows, separate from the data model.

```csharp{title="Perspective Scope" description="PerspectiveScope stores scope metadata on perspective rows, separate from the data model." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Perspective", "Scope"] tests=["PerspectiveScopeTests.PerspectiveScope_TenantId_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_CustomerId_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_UserId_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_OrganizationId_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_AllowedPrincipals_StoresPrincipalsAsync", "PerspectiveScopeTests.PerspectiveScope_GetValue_StandardProperty_TenantId_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_GetValue_Extension_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_GetValue_Unknown_ReturnsNullAsync"]}
public class PerspectiveScope {
  public string? TenantId { get; set; }
  public string? CustomerId { get; set; }
  public string? UserId { get; set; }
  public string? OrganizationId { get; set; }

  // Security principals that have access to this record
  // (string form, e.g. "user:alice", "group:sales-team")
  public List<string> AllowedPrincipals { get; set; } = [];

  // Custom extension properties
  public List<ScopeExtension> Extensions { get; set; } = [];

  // Unified access by key name
  public string? GetValue(string key);  // TenantId/CustomerId/UserId/OrganizationId,
                                        // falls back to Extensions
}
```

## Security System Events

The security system emits events for auditing.

### AccessDenied

Emitted when access is denied due to insufficient permissions.

```csharp{title="AccessDenied" description="Emitted when access is denied due to insufficient permissions." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "AccessDenied"]}
public sealed record AccessDenied : ISystemEvent {
  public Guid Id { get; init; } = TrackedGuid.NewMedo();
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

```csharp{title="AccessGranted" description="Emitted when access to a sensitive resource is granted (optional, for audit trails)." category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "AccessGranted"]}
public sealed record AccessGranted : ISystemEvent {
  public Guid Id { get; init; } = TrackedGuid.NewMedo();
  public required string ResourceType { get; init; }
  public string? ResourceId { get; init; }
  public required Permission UsedPermission { get; init; }
  public required ScopeFilters AccessFilter { get; init; }
  public required PerspectiveScope Scope { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
}
```

## Exceptions {#exceptions}

### AccessDeniedException

Thrown when a security check fails due to insufficient permissions.

```csharp{title="AccessDeniedException" description="Thrown when a security check fails due to insufficient permissions." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "AccessDeniedException"] tests=["AccessDeniedExceptionTests.AccessDeniedException_Constructor_SetsAllPropertiesAsync", "AccessDeniedExceptionTests.AccessDeniedException_DefaultReason_IsInsufficientPermissionAsync", "AccessDeniedExceptionTests.AccessDeniedException_CanBeCaughtAsync"]}
public sealed class AccessDeniedException : Exception {
  public Permission RequiredPermission { get; }
  public string ResourceType { get; }
  public string? ResourceId { get; }
  public AccessDenialReason Reason { get; }

  public AccessDeniedException(
    Permission requiredPermission,
    string resourceType,
    string? resourceId = null,
    AccessDenialReason reason = AccessDenialReason.InsufficientPermission
  );
}

public enum AccessDenialReason {
  InsufficientPermission,
  InsufficientRole,
  ScopeViolation,
  PolicyRejected
}
```

### Exception Handling

```csharp{title="Exception Handling" description="Exception Handling" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Exception", "Handling"] tests=["AccessDeniedExceptionTests.AccessDeniedException_CanBeCaughtAsync", "AccessDeniedExceptionTests.AccessDeniedException_Constructor_SetsAllPropertiesAsync"]}
try {
  var lens = factory.GetLens<IOrderLens>(
    ScopeFilters.Tenant,
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

```csharp{title="Registering Security Services" description="Registering Security Services" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "C#", "Registering", "Services"] unverified="DI service-registration wiring; not exercised by Core security unit tests"}
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

```csharp{title="Extracting from JWT Claims" description="Extracting from JWT Claims" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Extracting", "JWT"] tests=["SecurityOptionsTests.SecurityOptions_ExtractMultipleClaims_AllExtractorsAddedAsync", "PermissionExtractorTests.SecurityOptions_ExtractorsFromClaims_ProduceCorrectResultsAsync"]}
var options = new SecurityOptions()
  .ExtractPermissionsFromClaim("permissions")  // "orders:read, orders:write"
  .ExtractRolesFromClaim("roles")              // "Admin, Support"
  .ExtractSecurityPrincipalsFromClaim("groups"); // "group:sales, group:managers"
```

## Marker Interfaces

Optional marker interfaces for models that include scope in their data:

```csharp{title="Marker Interfaces" description="Optional marker interfaces for models that include scope in their data:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Marker", "Interfaces"]}
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

### For Contributors

Looking to extend the security system? See:
- [Custom Policies](../../extending/extensibility/custom-policies.md) — Build custom authorization policies and permission evaluation strategies

## Related Documentation

- [Scoping](./scoping.md) - Scope system overview
- [System Events](../events/system-events.md) - Audit and monitoring events
- [Implementing Multi-Tenancy](./implementing-multi-tenancy.md) - End-to-end guide
- [Security Best Practices](../../operations/deployment/security.md) - Authentication, authorization, encryption
