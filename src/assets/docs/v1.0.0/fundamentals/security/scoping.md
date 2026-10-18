---
title: Scoping
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Core Concepts
description: Multi-tenancy and data isolation through composable scope filters, enabling tenant, user, organization, and principal-based access patterns.
codeReferences:
  - src/Whizbang.Core/Scoping/IScopedInterfaces.cs
  - src/Whizbang.Core/Lenses/ScopeFilter.cs
  - src/Whizbang.Core/Lenses/ScopeFilterBuilder.cs
  - src/Whizbang.Core/Lenses/PerspectiveScope.cs
  - src/Whizbang.Core/Lenses/InheritScopeAttribute.cs
  - src/Whizbang.Core/Lenses/ScopeInheritance.cs
  - src/Whizbang.Core/Lenses/IScopedLensFactory.cs
  - src/Whizbang.Core/Lenses/ScopedLensFactory.cs
  - src/Whizbang.Core/Security/SecurityPrincipalId.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveStore.cs
testReferences:
  - tests/Whizbang.Core.Tests/Scoping/PerspectiveScopeTests.cs
  - tests/Whizbang.Core.Tests/Scoping/MarkerInterfaceTests.cs
  - tests/Whizbang.Core.Tests/Scoping/PerspectiveScopeFilterByFieldsTests.cs
  - tests/Whizbang.Core.Tests/Scoping/InheritScopeAttributeTests.cs
  - tests/Whizbang.Core.Tests/Scoping/ScopeInheritanceTests.cs
  - tests/Whizbang.Core.Tests/Lenses/ScopeFilterTests.cs
  - tests/Whizbang.Core.Tests/Lenses/ScopeFilterBuilderTests.cs
  - tests/Whizbang.Core.Tests/Lenses/ScopedLensFactoryTests.cs
  - tests/Whizbang.Core.Tests/Lenses/ScopedLensFactoryImplTests.cs
lastMaintainedCommit: '01f07906'
---

# Scoping System

Whizbang's scoping system provides flexible multi-tenancy and data isolation through composable filters, enabling tenant, user, organization, and principal-based access patterns.

## Overview

Scoping in Whizbang separates data isolation concerns from your domain models:

- **PerspectiveScope** - Metadata stored with each row (TenantId, UserId, etc.)
- **ScopeFilters** - Composable flags enum for query filtering
- **ScopeFilterBuilder** - Builds filter info from flags and context
- **IScopedLensFactory** - Resolves lenses with scope filters applied

## PerspectiveScope {#perspective-scope}

`PerspectiveScope` is stored in the `scope` column of perspective rows, separate from your data model.

```csharp{title="PerspectiveScope" description="PerspectiveScope is stored in the scope column of perspective rows, separate from your data model." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "PerspectiveScope", "Perspective-scope"] tests=["PerspectiveScopeTests.PerspectiveScope_TenantId_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_UserId_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_AllowedPrincipals_DefaultsToEmptyListAsync", "PerspectiveScopeTests.PerspectiveScope_GetValue_StandardProperty_TenantId_ReturnsValueAsync"]}
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

```csharp{title="Accessing Scope Values" description="Accessing Scope Values" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Accessing", "Scope"] tests=["PerspectiveScopeTests.PerspectiveScope_GetValue_StandardProperty_TenantId_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_GetValue_Extension_ReturnsValueAsync", "PerspectiveScopeTests.PerspectiveScope_GetValue_Unknown_ReturnsNullAsync"]}
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

```csharp{title="ITenantScoped" description="ITenantScoped" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "ITenantScoped"] tests=["MarkerInterfaceTests.ITenantScoped_ImplementingModel_HasTenantIdAsync"]}
public interface ITenantScoped {
  string TenantId { get; }
}
```

Use when tenant ID is part of the domain model:

```csharp{title="ITenantScoped - Order" description="Use when tenant ID is part of the domain model:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "ITenantScoped"] unverified="Consumer domain model implementing the marker interface, not a library API"}
public class Order : ITenantScoped {
  public string TenantId { get; init; }
  public string OrderNumber { get; init; }
  public decimal Total { get; init; }
}
```

### IUserScoped

```csharp{title="IUserScoped" description="IUserScoped" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "IUserScoped"] tests=["MarkerInterfaceTests.IUserScoped_ImplementingModel_HasUserIdAndTenantIdAsync", "MarkerInterfaceTests.IUserScoped_InheritedFromITenantScoped_CanBeUsedAsTenantScopedAsync"]}
public interface IUserScoped : ITenantScoped {
  string UserId { get; }
}
```

For models scoped to both tenant and user:

```csharp{title="IUserScoped - SavedSearch" description="For models scoped to both tenant and user:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "IUserScoped"] unverified="Consumer domain model illustration, not a library API"}
public class SavedSearch : IUserScoped {
  public string TenantId { get; init; }
  public string UserId { get; init; }
  public string Name { get; init; }
  public string Query { get; init; }
}
```

### IOrganizationScoped

```csharp{title="IOrganizationScoped" description="IOrganizationScoped" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "IOrganizationScoped"] tests=["MarkerInterfaceTests.IOrganizationScoped_ImplementingModel_HasOrganizationIdAndTenantIdAsync"]}
public interface IOrganizationScoped : ITenantScoped {
  string OrganizationId { get; }
}
```

For models scoped to organization within a tenant:

```csharp{title="IOrganizationScoped - Department" description="For models scoped to organization within a tenant:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "IOrganizationScoped"] unverified="Consumer domain model illustration, not a library API"}
public class Department : IOrganizationScoped {
  public string TenantId { get; init; }
  public string OrganizationId { get; init; }
  public string Name { get; init; }
}
```

### ICustomerScoped

```csharp{title="ICustomerScoped" description="ICustomerScoped" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "ICustomerScoped"] tests=["MarkerInterfaceTests.ICustomerScoped_ImplementingModel_HasCustomerIdAndTenantIdAsync"]}
public interface ICustomerScoped : ITenantScoped {
  string CustomerId { get; }
}
```

For models scoped to customer within a tenant:

```csharp{title="ICustomerScoped - Invoice" description="For models scoped to customer within a tenant:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "ICustomerScoped"] unverified="Consumer domain model illustration, not a library API"}
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

`ScopeFilters` (note the plural — the enum type is `ScopeFilters`, declared in `ScopeFilter.cs`) is a flags enum for composable filtering.

```csharp{title="Scope Filters" description="ScopeFilters is a flags enum for composable filtering." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Scope", "Filters"] tests=["ScopeFilterTests.ScopeFilter_None_HasZeroValueAsync", "ScopeFilterTests.ScopeFilter_Tenant_HasCorrectValueAsync", "ScopeFilterTests.ScopeFilter_Organization_HasCorrectValueAsync", "ScopeFilterTests.ScopeFilter_Customer_HasCorrectValueAsync", "ScopeFilterTests.ScopeFilter_User_HasCorrectValueAsync", "ScopeFilterTests.ScopeFilter_Principal_HasCorrectValueAsync"]}
[Flags]
public enum ScopeFilters {
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

```csharp{title="Filter Composition" description="Combine filters with bitwise OR:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Filter", "Composition"] tests=["ScopeFilterTests.ScopeFilter_CombinedFlags_CanBeOrTogetherAsync", "ScopeFilterTests.ScopeFilter_HasFlag_DetectsIndividualFlagsAsync"]}
// Single filter
var tenantOnly = ScopeFilters.Tenant;

// Multiple filters (AND'd together)
var tenantAndUser = ScopeFilters.Tenant | ScopeFilters.User;

// Complex combination
var complex = ScopeFilters.Tenant | ScopeFilters.Organization | ScopeFilters.Principal;
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

```csharp{title="Special OR Logic" description="When both User and Principal filters are specified, they're OR'd together (not AND'd)." category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Special", "Logic"] tests=["ScopeFilterBuilderTests.ScopeFilterBuilder_TenantUserPrincipal_BuildsTenantAndUserOrPrincipalAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetMyOrSharedLensMethodAsync"]}
// Get my orders and orders shared with my groups
var lens = factory.GetMyOrSharedLens<IOrderLens>();
// Equivalent to: ScopeFilters.Tenant | ScopeFilters.User | ScopeFilters.Principal

// Generated: WHERE TenantId = ? AND (UserId = ? OR AllowedPrincipals ?| [...])
```

## Filter Patterns {#filter-patterns}

`ScopeFilterExtensions` provides common filter pattern combinations as static properties:

```csharp{title="Filter Patterns" description="ScopeFilterExtensions provides common filter pattern combinations as static properties:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Filter", "Patterns"] tests=["ScopeFilterTests.ScopeFilterExtensions_TenantUser_ReturnsTenantOrUserAsync", "ScopeFilterTests.ScopeFilterExtensions_TenantPrincipal_ReturnsTenantOrPrincipalAsync", "ScopeFilterTests.ScopeFilterExtensions_TenantUserOrPrincipal_ReturnsAllThreeAsync"]}
public static class ScopeFilterExtensions {
  // Tenant + User isolation
  // WHERE TenantId = ? AND UserId = ?
  public static ScopeFilters TenantUser =>
    ScopeFilters.Tenant | ScopeFilters.User;

  // Tenant + Principal-based access
  // WHERE TenantId = ? AND AllowedPrincipals ?| [...]
  public static ScopeFilters TenantPrincipal =>
    ScopeFilters.Tenant | ScopeFilters.Principal;

  // Tenant + User's own OR shared with them (special OR logic)
  // WHERE TenantId = ? AND (UserId = ? OR AllowedPrincipals ?| [...])
  public static ScopeFilters TenantUserOrPrincipal =>
    ScopeFilters.Tenant | ScopeFilters.User | ScopeFilters.Principal;
}
```

### Usage

```csharp{title="Usage" description="Usage" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Usage"] tests=["ScopeFilterTests.ScopeFilterExtensions_TenantUser_ReturnsTenantOrUserAsync", "ScopeFilterTests.ScopeFilterExtensions_TenantPrincipal_ReturnsTenantOrPrincipalAsync", "ScopeFilterTests.ScopeFilterExtensions_TenantUserOrPrincipal_ReturnsAllThreeAsync"]}
// Use predefined patterns
var myRecords = ScopeFilterExtensions.TenantUser;
var sharedWithMe = ScopeFilterExtensions.TenantPrincipal;
var myOrShared = ScopeFilterExtensions.TenantUserOrPrincipal;

// Or compose your own
var custom = ScopeFilters.Tenant | ScopeFilters.Organization;
```

## Scope Filter Builder

`ScopeFilterBuilder` builds filter information from flags and the current scope context.

```csharp{title="Scope Filter Builder" description="ScopeFilterBuilder builds filter information from flags and the current scope context." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Scope", "Filter"] tests=["ScopeFilterBuilderTests.ScopeFilterBuilder_TenantAndUser_BuildsAndFilterAsync"]}
// Build filter info
var filterInfo = ScopeFilterBuilder.Build(
  ScopeFilters.Tenant | ScopeFilters.User,
  scopeContext);

// Filter info contains:
filterInfo.Filters;        // ScopeFilters.Tenant | ScopeFilters.User
filterInfo.TenantId;       // "tenant-123"
filterInfo.UserId;         // "user-456"
filterInfo.UseOrLogicForUserAndPrincipal;  // false
```

### ScopeFilterInfo

```csharp{title="ScopeFilterInfo" description="ScopeFilterInfo" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "ScopeFilterInfo"] tests=["ScopeFilterBuilderTests.ScopeFilterInfo_IsEmpty_TrueWhenNoFiltersAsync", "ScopeFilterBuilderTests.ScopeFilterInfo_IsEmpty_FalseWhenFiltersSetAsync"]}
public readonly record struct ScopeFilterInfo {
  public ScopeFilters Filters { get; init; }
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

```csharp{title="Validation" description="`ScopeFilterBuilder." category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Validation"] tests=["ScopeFilterBuilderTests.ScopeFilterBuilder_MissingTenantId_ThrowsAsync", "ScopeFilterBuilderTests.ScopeFilterBuilder_EmptyPrincipals_ThrowsAsync"]}
// Throws InvalidOperationException if TenantId is null
ScopeFilterBuilder.Build(ScopeFilters.Tenant, contextWithoutTenant);
// "Tenant filter requested but TenantId is not set in scope context."

// Throws if SecurityPrincipals is empty
ScopeFilterBuilder.Build(ScopeFilters.Principal, contextWithoutPrincipals);
// "Principal filter requested but SecurityPrincipals is empty in scope context."
```

## IScopedLensFactory

The factory resolves lenses with scope filters automatically applied.

```csharp{title="IScopedLensFactory" description="The factory resolves lenses with scope filters automatically applied." category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "IScopedLensFactory"] tests=["ScopedLensFactoryTests.IScopedLensFactory_HasGetLens_ScopeFilter_MethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetLens_ScopeFilter_Permission_MethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetGlobalLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetTenantLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetUserLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetOrganizationLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetCustomerLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetPrincipalLensMethodAsync", "ScopedLensFactoryTests.IScopedLensFactory_HasGetMyOrSharedLensMethodAsync"]}
// Get lens with specific filters
var lens = factory.GetLens<IOrderLens>(ScopeFilters.Tenant);

// Get lens with filters + permission check
var lens = factory.GetLens<IOrderLens>(
  ScopeFilters.Tenant,
  Permission.Read("orders"));

// Convenience methods
factory.GetGlobalLens<T>();       // ScopeFilters.None
factory.GetTenantLens<T>();       // ScopeFilters.Tenant
factory.GetUserLens<T>();         // Tenant | User
factory.GetOrganizationLens<T>(); // Tenant | Organization
factory.GetCustomerLens<T>();     // Tenant | Customer
factory.GetPrincipalLens<T>();    // Tenant | Principal
factory.GetMyOrSharedLens<T>();   // Tenant | User | Principal
```

### IFilterableLens

Lenses that support filtering implement `IFilterableLens`:

```csharp{title="IFilterableLens" description="Lenses that support filtering implement IFilterableLens:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "IFilterableLens"] unverified="Interface contract declaration with no dedicated mapped test"}
public interface IFilterableLens {
  void ApplyFilter(ScopeFilterInfo filterInfo);
}
```

When a lens is resolved through `IScopedLensFactory`, the filter info is automatically applied.

## Common Patterns

### Tenant Isolation

Every record belongs to exactly one tenant:

```csharp{title="Tenant Isolation" description="Every record belongs to exactly one tenant:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Tenant", "Isolation"] unverified="Consumer usage pattern combining the perspective store and lens query; TenantIsolationTests is absent from the code-tests map"}
// Store with tenant scope
await perspective.UpsertAsync(streamId, order, new PerspectiveScope {
  TenantId = currentTenant
});

// Query within tenant — the factory pre-applies the filter to the lens's Query
var lens = factory.GetTenantLens<IOrderLens>();
var orders = await lens.Query.ToListAsync();  // Only current tenant's rows
```

### User Ownership

Records owned by specific users:

```csharp{title="User Ownership" description="Records owned by specific users:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "User", "Ownership"] unverified="Consumer usage pattern storing and querying through the scoped lens"}
// Store with user scope
await perspective.UpsertAsync(streamId, savedSearch, new PerspectiveScope {
  TenantId = currentTenant,
  UserId = currentUser
});

// Query user's records
var lens = factory.GetUserLens<ISavedSearchLens>();
var searches = await lens.Query.ToListAsync();  // Only current user's rows
```

### Group-Based Sharing

Records shared with security groups:

```csharp{title="Group-Based Sharing" description="Records shared with security groups:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Group-Based", "Sharing"] unverified="Consumer usage pattern for principal sharing; SecurityPrincipalId construction is incidental to the illustration"}
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
var reports = await lens.Query.ToListAsync();  // Rows accessible to caller
```

### My Records OR Shared With Me

Combining user ownership and group sharing:

```csharp{title="My Records OR Shared With Me" description="Combining user ownership and group sharing:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Records", "Shared"] unverified="Consumer usage pattern illustrating the my-or-shared lens"}
// Get lens for "my records + shared"
var lens = factory.GetMyOrSharedLens<IDocumentLens>();
var docs = await lens.Query.ToListAsync();

// Returns documents where:
// - UserId = current user, OR
// - AllowedPrincipals contains any of caller's security principals
```

## Extension Properties

Add custom scope properties without schema changes:

```csharp{title="Extension Properties" description="Add custom scope properties without schema changes:" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Extension", "Properties"] unverified="Consumer usage pattern combining scope extensions with a persistence and EF query workflow"}
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

## Scope Inheritance {#scope-inheritance}

A perspective row's scope is written by the perspective runner from the scope of the messages applied to it. You do not set it in `Apply`. `[InheritScope]` on the perspective's **model** type decides which fields a row takes, and when.

**Creation records ownership.** With no attribute, a new row copies every scope field from the message that created it: tenant, user, customer, organization, allowed principals and extensions. Who created a row matters for audit and for security. Whether a read cares is the lens's decision, through how it filters (by tenant, by user, by principal), not the row's.

**Scope is set once.** After creation the row keeps the scope it was created with, unless the model names fields in `Always` or an `IScopeEvent` replaces the scope.

| Setting | When the row is created | When a later message is applied |
|---|---|---|
| No attribute, or `[InheritScope]` | Every field | Unchanged |
| `OnCreate = ...` | Only the named fields | Unchanged |
| `Always = ...` | The `OnCreate` and `Always` fields | The `Always` fields follow the latest writer; the rest stay |
| `OnCreate = None, Always = None` | No scope at all (reported as [WHIZ171](../../operations/diagnostics/whiz171)) | Unchanged |

```mermaid{caption="How the perspective runner decides a row's scope for each write: a scope event replaces it, a new row takes the OnCreate and Always fields, and an existing row changes only its Always fields." tests=["ScopeInheritanceTests.Resolve_ScopeEvent_ForcesTheEventsScopeAsBeforeAsync", "ScopeInheritanceTests.Resolve_NewRow_CarriesTheCreateAndAlwaysFieldsAsync", "ScopeInheritanceTests.Resolve_ExistingRow_WithNoAlwaysFields_LeavesTheStoredScopeAloneAsync", "ScopeInheritanceTests.Resolve_ExistingRow_WithAlwaysFields_UpdatesOnlyThoseFieldsAsync"]}
flowchart TD
  A[Message applied to a perspective row] --> B{IScopeEvent?}
  B -- yes --> C[Row scope replaced by the event's scope]
  B -- no --> D{Row exists?}
  D -- no --> E[New row: OnCreate and Always fields from the message]
  D -- yes --> F{Always fields named?}
  F -- no --> G[Row scope unchanged]
  F -- yes --> H[Always fields taken from the message; every other field kept]
```

A message that does not carry a field leaves the row's value in place, so a system write with no user does not erase who last wrote the row.

```csharp{title="Scope inheritance on perspective models" description="Ownership at creation by default; last-modified-by with Always; tenant-only for a shared resource." category="Security" difficulty="INTERMEDIATE" tags=["Scoping", "InheritScope", "Perspectives"] tests=["InheritScopeAttributeTests.InheritScope_Defaults_AreEveryFieldOnCreate_AndNoneAlwaysAsync", "ScopeInheritanceTests.Resolve_ExistingRow_WithAlwaysFields_UpdatesOnlyThoseFieldsAsync", "ScopeInheritanceTests.Resolve_NewRow_CarriesTheCreateAndAlwaysFieldsAsync"]}
// No attribute: every field at creation, set once. The row records who created it.
public class WorkflowModel { /* ... */ }

// Last-modified-by: every field at creation, and the user follows the latest writer.
[InheritScope(Always = ScopeFields.User)]
public class CollaborativeDocModel { /* ... */ }

// A shared resource that records only its tenant, never who created it.
[InheritScope(OnCreate = ScopeFields.Tenant)]
public class CatalogItemModel { /* ... */ }
```

**Put the attribute on the model.** The runner reads it from the `TModel` of `IPerspectiveFor<TModel, ...>`. On a perspective class over another model it has no effect, and the build reports [WHIZ170](../../operations/diagnostics/whiz170).

**Changing scope later.** Publish an event that implements `IScopeEvent` to replace a row's scope, for example to share it with groups through `AllowedPrincipals`. A perspective that implements `IPerspectiveScopeFor<TModel>` decides how a proposed scope is merged, and takes precedence over both `[InheritScope]` and `IScopeEvent`.

**Rewinds.** A rewind that recreates a row writes its scope as at creation. A rewind over an existing row leaves the stored scope alone; `Always` fields catch up on the next live apply.

## Related Documentation

- [Security](./security.md) - Permissions, roles, and access control
- [Scoped Lenses](../lenses/scoped-lenses.md) - Automatic scope-based filtering
- [System Events](../events/system-events.md) - Audit and monitoring events
