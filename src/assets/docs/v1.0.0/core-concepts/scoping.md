# Scoping System

Whizbang's scoping system provides flexible multi-tenancy and data isolation through composable filters, enabling tenant, user, organization, and principal-based access patterns.

## Overview

Scoping in Whizbang separates data isolation concerns from your domain models:

- **PerspectiveScope** - Metadata stored with each row (TenantId, UserId, etc.)
- **ScopeFilter** - Composable flags for query filtering
- **ScopeFilterBuilder** - Builds filter info from flags and context
- **IScopedLensFactory** - Resolves lenses with scope filters applied

## PerspectiveScope

`PerspectiveScope` is stored in the `scope` column of perspective rows, separate from your data model.

```csharp
public record PerspectiveScope {
  // Standard scope properties
  public string? TenantId { get; init; }
  public string? UserId { get; init; }
  public string? OrganizationId { get; init; }
  public string? CustomerId { get; init; }

  // Security principal access list
  public IReadOnlyList<SecurityPrincipalId>? AllowedPrincipals { get; init; }

  // Custom extension properties
  public IReadOnlyDictionary<string, string?>? Extensions { get; init; }

  // Unified indexer access
  public string? this[string key] => ...;
}
```

### Why Separate from Data?

Storing scope separately from your domain data provides:

1. **Clean domain models** - Your `Order` class doesn't need `TenantId`
2. **Consistent filtering** - All perspectives filter the same way
3. **Flexible extensions** - Add custom scope properties without schema changes
4. **Security isolation** - Scope enforcement happens at infrastructure level

### Accessing Scope Values

```csharp
var scope = new PerspectiveScope {
  TenantId = "tenant-123",
  UserId = "user-456",
  Extensions = new Dictionary<string, string?> {
    ["department"] = "Engineering",
    ["region"] = "us-west"
  }
};

// Via properties
var tenant = scope.TenantId;  // "tenant-123"

// Via indexer (standard + extensions)
var tenant = scope["TenantId"];     // "tenant-123"
var dept = scope["department"];     // "Engineering"
var unknown = scope["unknown"];     // null
```

## Scope Filters

`ScopeFilter` is a flags enum for composable filtering.

```csharp
[Flags]
public enum ScopeFilter {
  None = 0,           // No filtering (global access)
  Tenant = 1 << 0,    // Filter by TenantId
  Organization = 1 << 1,
  Customer = 1 << 2,
  User = 1 << 3,      // Filter by UserId
  Principal = 1 << 4  // Filter by security principal overlap
}
```

### Filter Composition

Combine filters with bitwise OR:

```csharp
// Single filter
var tenantOnly = ScopeFilter.Tenant;

// Multiple filters (AND'd together)
var tenantAndUser = ScopeFilter.Tenant | ScopeFilter.User;

// Complex combination
var complex = ScopeFilter.Tenant | ScopeFilter.Organization | ScopeFilter.Principal;
```

### Filter Application

| Filter | Generated WHERE |
|--------|-----------------|
| `None` | *(no filter)* |
| `Tenant` | `WHERE scope->>'TenantId' = ?` |
| `Tenant \| User` | `WHERE scope->>'TenantId' = ? AND scope->>'UserId' = ?` |
| `Tenant \| Principal` | `WHERE scope->>'TenantId' = ? AND scope->'AllowedPrincipals' ?| [...]` |
| `Tenant \| User \| Principal` | `WHERE scope->>'TenantId' = ? AND (scope->>'UserId' = ? OR scope->'AllowedPrincipals' ?| [...])` |

### Special OR Logic

When both `User` and `Principal` filters are specified, they're OR'd together (not AND'd). This enables the "my records OR shared with me" pattern:

```csharp
// Get my orders and orders shared with my groups
var lens = factory.GetMyOrSharedLens<IOrderLens>();
// Equivalent to: Tenant | User | Principal

// Generated: WHERE TenantId = ? AND (UserId = ? OR AllowedPrincipals ?| [...])
```

## Scope Filter Builder

`ScopeFilterBuilder` builds filter information from flags and the current scope context.

```csharp
// Build filter info
var filterInfo = ScopeFilterBuilder.Build(
  ScopeFilter.Tenant | ScopeFilter.User,
  scopeContext);

// Filter info contains:
filterInfo.Filters;        // ScopeFilter.Tenant | ScopeFilter.User
filterInfo.TenantId;       // "tenant-123"
filterInfo.UserId;         // "user-456"
filterInfo.UseOrLogicForUserAndPrincipal;  // false
```

### ScopeFilterInfo

```csharp
public readonly record struct ScopeFilterInfo {
  public ScopeFilter Filters { get; init; }
  public string? TenantId { get; init; }
  public string? UserId { get; init; }
  public string? OrganizationId { get; init; }
  public string? CustomerId { get; init; }
  public IReadOnlySet<SecurityPrincipalId> SecurityPrincipals { get; init; }
  public bool UseOrLogicForUserAndPrincipal { get; init; }
  public bool IsEmpty { get; }
}
```

## IScopedLensFactory

The factory resolves lenses with scope filters automatically applied.

```csharp
// Get lens with specific filters
var lens = factory.GetLens<IOrderLens>(ScopeFilter.Tenant);

// Get lens with filters + permission check
var lens = factory.GetLens<IOrderLens>(
  ScopeFilter.Tenant,
  Permission.Read("orders"));

// Convenience methods
factory.GetGlobalLens<T>();       // ScopeFilter.None
factory.GetTenantLens<T>();       // ScopeFilter.Tenant
factory.GetUserLens<T>();         // Tenant | User
factory.GetOrganizationLens<T>(); // Tenant | Organization
factory.GetCustomerLens<T>();     // Tenant | Customer
factory.GetPrincipalLens<T>();    // Tenant | Principal
factory.GetMyOrSharedLens<T>();   // Tenant | User | Principal
```

### IFilterableLens

Lenses that support filtering implement `IFilterableLens`:

```csharp
public interface IFilterableLens {
  void ApplyFilter(ScopeFilterInfo filterInfo);
}
```

When a lens is resolved through `IScopedLensFactory`, the filter info is automatically applied.

## Common Patterns

### Tenant Isolation

Every record belongs to exactly one tenant:

```csharp
// Store with tenant scope
await perspective.UpsertAsync(streamId, order, new PerspectiveScope {
  TenantId = currentTenant
});

// Query within tenant
var lens = factory.GetTenantLens<IOrderLens>();
var orders = await lens.GetAllAsync();  // Only current tenant's orders
```

### User Ownership

Records owned by specific users:

```csharp
// Store with user scope
await perspective.UpsertAsync(streamId, savedSearch, new PerspectiveScope {
  TenantId = currentTenant,
  UserId = currentUser
});

// Query user's records
var lens = factory.GetUserLens<ISavedSearchLens>();
var searches = await lens.GetAllAsync();  // Only current user's searches
```

### Group-Based Sharing

Records shared with security groups:

```csharp
// Store with allowed principals
await perspective.UpsertAsync(streamId, report, new PerspectiveScope {
  TenantId = currentTenant,
  AllowedPrincipals = new[] {
    SecurityPrincipalId.User("creator-123"),
    SecurityPrincipalId.Group("finance-team"),
    SecurityPrincipalId.Group("executives")
  }
});

// Query records shared with caller's groups
var lens = factory.GetPrincipalLens<IReportLens>();
var reports = await lens.GetAllAsync();  // Reports accessible to caller
```

### My Records OR Shared With Me

Combining user ownership and group sharing:

```csharp
// Get lens for "my records + shared"
var lens = factory.GetMyOrSharedLens<IDocumentLens>();
var docs = await lens.GetAllAsync();

// Returns documents where:
// - UserId = current user, OR
// - AllowedPrincipals contains any of caller's security principals
```

## Extension Properties

Add custom scope properties without schema changes:

```csharp
// Store with extensions
await perspective.UpsertAsync(streamId, order, new PerspectiveScope {
  TenantId = currentTenant,
  Extensions = new Dictionary<string, string?> {
    ["region"] = "us-west",
    ["department"] = "sales",
    ["costCenter"] = "CC-123"
  }
});

// Access via indexer
var region = scope["region"];  // "us-west"
```

## Related Documentation

- [Security](./security.md) - Permissions, roles, and access control
- [System Events](./system-events.md) - Audit and monitoring events
