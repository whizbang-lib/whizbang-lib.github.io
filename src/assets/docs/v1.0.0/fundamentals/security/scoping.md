---
title: Scoping
version: 1.0.0
category: Core Concepts
description: Multi-tenancy and data isolation through composable scope filters, enabling tenant, user, organization, and principal-based access patterns.
---

# Scoping System

Whizbang's scoping system provides flexible multi-tenancy and data isolation through composable filters, enabling tenant, user, organization, and principal-based access patterns.

## Overview

Scoping in Whizbang separates data isolation concerns from your domain models:

- **PerspectiveScope** - Metadata stored with each row (TenantId, UserId, etc.)
- **ScopeFilter** - Composable flags for query filtering
- **ScopeFilterBuilder** - Builds filter info from flags and context
- **IScopedLensFactory** - Resolves lenses with scope filters applied

## PerspectiveScope {#perspective-scope}

`PerspectiveScope` is stored in the `scope` column of perspective rows, separate from your data model.

```csharp
public class PerspectiveScope {
  // Standard scope properties
  public string? TenantId { get; set; }
  public string? UserId { get; set; }
  public string? OrganizationId { get; set; }
  public string? CustomerId { get; set; }

  // Security principal access list
  public List<string> AllowedPrincipals { get; set; } = [];

  // Custom extension properties
  public List<ScopeExtension> Extensions { get; set; } = [];

  // Value access method
  public string? GetValue(string key) => ...;
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
  UserId = "user-456"
};

// Set extensions
scope.SetExtension("department", "Engineering");
scope.SetExtension("region", "us-west");

// Via properties
var tenant = scope.TenantId;  // "tenant-123"

// Via GetValue method (standard + extensions)
var tenant = scope.GetValue("TenantId");     // "tenant-123"
var dept = scope.GetValue("department");     // "Engineering"
var unknown = scope.GetValue("unknown");     // null
```

### EF Core ComplexProperty Support

`PerspectiveScope` is designed for full LINQ query support via EF Core's `ComplexProperty().ToJson()`:

- Extensions use `List<ScopeExtension>` (not Dictionary) for ToJson() compatibility
- All properties support direct LINQ queries: `.Where(r => r.Scope.TenantId == "x")`
- Extension queries: `.Where(r => r.Scope.Extensions.Any(e => e.Key == "region"))`

## Marker Interfaces {#marker-interfaces}

Whizbang provides marker interfaces for models that include scope identifiers in the data model itself. These are **optional** - use them when the scope ID is part of your business data, not just infrastructure.

### ITenantScoped

```csharp
public interface ITenantScoped {
  string TenantId { get; }
}
```

Use when tenant ID is part of the domain model:

```csharp
public class Order : ITenantScoped {
  public string TenantId { get; init; }
  public string OrderNumber { get; init; }
  public decimal Total { get; init; }
}
```

### IUserScoped

```csharp
public interface IUserScoped : ITenantScoped {
  string UserId { get; }
}
```

For models scoped to both tenant and user:

```csharp
public class SavedSearch : IUserScoped {
  public string TenantId { get; init; }
  public string UserId { get; init; }
  public string Name { get; init; }
  public string Query { get; init; }
}
```

### IOrganizationScoped

```csharp
public interface IOrganizationScoped : ITenantScoped {
  string OrganizationId { get; }
}
```

For models scoped to organization within a tenant:

```csharp
public class Department : IOrganizationScoped {
  public string TenantId { get; init; }
  public string OrganizationId { get; init; }
  public string Name { get; init; }
}
```

### ICustomerScoped

```csharp
public interface ICustomerScoped : ITenantScoped {
  string CustomerId { get; }
}
```

For models scoped to customer within a tenant:

```csharp
public class Invoice : ICustomerScoped {
  public string TenantId { get; init; }
  public string CustomerId { get; init; }
  public string InvoiceNumber { get; init; }
  public decimal Amount { get; init; }
}
```

### Marker Interfaces vs PerspectiveScope

| Aspect | Marker Interfaces | PerspectiveScope |
|--------|-------------------|------------------|
| **Location** | In your data model | In `scope` column |
| **Purpose** | Business data | Infrastructure filtering |
| **When to use** | Scope ID needed in domain | Just need filtering |
| **Example** | `Order.TenantId` for reporting | Filter queries by tenant |

You can use both together - the marker interface for domain logic and PerspectiveScope for automatic filtering.

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

### Filter Composition {#filter-composition}

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

## Filter Patterns {#filter-patterns}

`ScopeFilterExtensions` provides common filter pattern combinations as static properties:

```csharp
public static class ScopeFilterExtensions {
  // Tenant + User isolation
  // WHERE TenantId = ? AND UserId = ?
  public static ScopeFilter TenantUser =>
    ScopeFilter.Tenant | ScopeFilter.User;

  // Tenant + Principal-based access
  // WHERE TenantId = ? AND AllowedPrincipals ?| [...]
  public static ScopeFilter TenantPrincipal =>
    ScopeFilter.Tenant | ScopeFilter.Principal;

  // Tenant + User's own OR shared with them (special OR logic)
  // WHERE TenantId = ? AND (UserId = ? OR AllowedPrincipals ?| [...])
  public static ScopeFilter TenantUserOrPrincipal =>
    ScopeFilter.Tenant | ScopeFilter.User | ScopeFilter.Principal;
}
```

### Usage

```csharp
// Use predefined patterns
var myRecords = ScopeFilterExtensions.TenantUser;
var sharedWithMe = ScopeFilterExtensions.TenantPrincipal;
var myOrShared = ScopeFilterExtensions.TenantUserOrPrincipal;

// Or compose your own
var custom = ScopeFilter.Tenant | ScopeFilter.Organization;
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

### Validation

`ScopeFilterBuilder.Build` validates that required scope values are present:

```csharp
// Throws InvalidOperationException if TenantId is null
ScopeFilterBuilder.Build(ScopeFilter.Tenant, contextWithoutTenant);
// "Tenant filter requested but TenantId is not set in scope context."

// Throws if SecurityPrincipals is empty
ScopeFilterBuilder.Build(ScopeFilter.Principal, contextWithoutPrincipals);
// "Principal filter requested but SecurityPrincipals is empty in scope context."
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
  AllowedPrincipals = [
    SecurityPrincipalId.User("creator-123"),
    SecurityPrincipalId.Group("finance-team"),
    SecurityPrincipalId.Group("executives")
  ]
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
var scope = new PerspectiveScope {
  TenantId = currentTenant
};
scope.SetExtension("region", "us-west");
scope.SetExtension("department", "sales");
scope.SetExtension("costCenter", "CC-123");

await perspective.UpsertAsync(streamId, order, scope);

// Access via GetValue method
var region = scope.GetValue("region");  // "us-west"

// Query with LINQ (EF Core)
var westOrders = await query
  .Where(r => r.Scope.Extensions.Any(e => e.Key == "region" && e.Value == "us-west"))
  .ToListAsync();
```

## Perspective Scope {#perspective-scope}

`PerspectiveScope` is the metadata structure stored in the `scope` column of perspective rows. It provides flexible, queryable scope information separate from your domain data.

**Key Properties**:
- **TenantId**: Multi-tenant isolation
- **UserId**: User ownership
- **OrganizationId**: Organizational hierarchy
- **CustomerId**: Customer-specific data
- **AllowedPrincipals**: Security principal access control list
- **Extensions**: Custom scope properties

See the [PerspectiveScope](#perspective-scope) section at the top of this document for complete details and examples.

## Related Documentation

- [Security](./security.md) - Permissions, roles, and access control
- [Scoped Lenses](./scoped-lenses.md) - Automatic scope-based filtering
- [System Events](./system-events.md) - Audit and monitoring events
