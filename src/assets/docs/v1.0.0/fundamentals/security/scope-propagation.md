---
title: Scope Propagation
version: 1.0.0
category: Core Concepts
order: 8
description: >-
  Delta-based scope propagation across message hops with explicit tenant strategy enforcement for system and impersonation operations.
tags: 'security, scope, tenant, multi-tenancy, system-operations, impersonation, delta, wire-format'
codeReferences:
  - src/Whizbang.Core/Security/ScopeDelta.cs
  - src/Whizbang.Core/Security/ScopePropJsonConverter.cs
  - src/Whizbang.Core/Dispatch/DispatcherSecurityExtensions.cs
  - src/Whizbang.Core/Dispatch/SystemDispatcherBuilder.cs
  - src/Whizbang.Core/Dispatch/ImpersonationDispatcherBuilder.cs
---

# Scope Propagation

Scope propagation ensures that security context (TenantId, UserId, roles, permissions) flows efficiently across message hops in distributed systems. Whizbang uses a **delta-based** approach to minimize wire size while maintaining full audit capabilities.

## Overview

When messages traverse multiple services, each hop can modify the security scope. Rather than storing the complete scope on every hop, Whizbang stores only the **changes** (delta) from the previous hop.

**Key Benefits:**
- **Minimal Wire Size**: Only changes are serialized, reducing message payload
- **Audit Trail**: Full history of scope changes across hops
- **Explicit Tenant Strategy**: Compile-time enforcement prevents accidental cross-tenant data leakage

## Explicit Tenant Strategy API

:::new{type="breaking"}
As of v1.0.0, `AsSystem()` and `RunAs()` require explicit tenant strategy selection. You must call `.ForAllTenants()`, `.ForTenant(id)`, or `.KeepTenant()` before dispatching.
:::

### System Operations

Use `AsSystem()` for timer/scheduler jobs, background workers, or elevated system operations:

```csharp{title="System Operations" description="Use AsSystem() for timer/scheduler jobs, background workers, or elevated system operations:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "System", "Operations"]}
// Cross-tenant system operation (use sparingly)
await _dispatcher.AsSystem().ForAllTenants().SendAsync(new ReindexAllTenantsCommand());

// Tenant-scoped system operation (most common)
await _dispatcher.AsSystem().ForTenant("tenant-123").SendAsync(new TenantMaintenanceCommand());

// Keep ambient tenant from current context
await _dispatcher.AsSystem().KeepTenant().SendAsync(new ProcessPendingItemsCommand());

// COMPILE ERROR: Must choose tenant strategy first!
// await _dispatcher.AsSystem().SendAsync(command);
```

### Impersonation Operations

Use `RunAs()` when an admin or service performs operations on behalf of another user:

```csharp{title="Impersonation Operations" description="Use RunAs() when an admin or service performs operations on behalf of another user:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Impersonation", "Operations"]}
// Support agent debugging in user's tenant
await _dispatcher.RunAs("target-user@example.com").ForTenant("user-tenant").SendAsync(debugCommand);

// Admin impersonating user in current tenant
await _dispatcher.RunAs(targetUserId).KeepTenant().SendAsync(command);

// Cross-tenant admin operation (rare)
await _dispatcher.RunAs("admin-system").ForAllTenants().SendAsync(systemCommand);
```

### Tenant Strategy Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `ForAllTenants()` | Sets TenantId to `"*"` (AllTenants constant) | System-wide operations, cross-tenant analytics |
| `ForTenant(id)` | Sets explicit tenant ID | Scheduled jobs, tenant-specific maintenance |
| `KeepTenant()` | Preserves ambient tenant | Operations within current request context |

### TenantConstants

The `TenantConstants.AllTenants` constant (`"*"`) represents cross-tenant operations:

```csharp{title="TenantConstants" description="The `TenantConstants." category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "TenantConstants"]}
public static class TenantConstants {
  /// <summary>
  /// Represents "all tenants" for cross-tenant system operations.
  /// Value is "*" (asterisk).
  /// </summary>
  public const string AllTenants = "*";
}
```

**Why `"*"` instead of `null`?**
- `null` is ambiguous (forgot to set vs intentional)
- `"*"` is universally understood as "wildcard/all"
- Easy to identify in logs and database queries

## Delta Storage on Message Hops

Each `MessageHop` can carry a `ScopeDelta` containing only the changes from the previous hop:

```csharp{title="Delta Storage on Message Hops" description="Each MessageHop can carry a ScopeDelta containing only the changes from the previous hop:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Delta", "Storage"]}
public sealed class ScopeDelta {
  /// <summary>Simple value changes (TenantId, UserId, etc.)</summary>
  [JsonPropertyName("v")]
  public Dictionary<ScopeProp, JsonElement>? Values { get; init; }

  /// <summary>Collection changes (Roles, Permissions, etc.)</summary>
  [JsonPropertyName("c")]
  public Dictionary<ScopeProp, CollectionChanges>? Collections { get; init; }
}
```

### Collection Changes

Collections (Roles, Permissions, SecurityPrincipals) support three operations:

```csharp{title="Collection Changes" description="Collections (Roles, Permissions, SecurityPrincipals) support three operations:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Collection", "Changes"]}
public readonly struct CollectionChanges {
  [JsonPropertyName("s")] public JsonElement? Set { get; init; }    // Replace entire collection
  [JsonPropertyName("a")] public JsonElement? Add { get; init; }    // Add values
  [JsonPropertyName("r")] public JsonElement? Remove { get; init; } // Remove values
}
```

**Apply Logic:**
- If `Set` is present → Replace entire collection
- Otherwise → Apply `Remove` first, then `Add`
- Missing property → Inherit from previous hop

### Rebuilding Full Scope

To get the current full scope, call `GetCurrentScope()` on the envelope:

```csharp{title="Rebuilding Full Scope" description="To get the current full scope, call GetCurrentScope() on the envelope:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Rebuilding", "Full"]}
var envelope = /* received message envelope */;
var fullScope = envelope.GetCurrentScope();

// Now you can check permissions, roles, etc.
if (fullScope?.HasPermission(Permission.Write)) {
  // Authorized
}
```

## Wire Format Reference

### Abbreviated Property Names

All scope-related types use abbreviated JSON property names for minimal wire size:

#### ScopeProp Enum Keys

| Enum Value | Abbreviated | Description |
|------------|-------------|-------------|
| `Scope` | `"Sc"` | PerspectiveScope (TenantId, UserId, etc.) |
| `Roles` | `"Ro"` | Security roles |
| `Perms` | `"Pe"` | Permissions |
| `Principals` | `"Pr"` | Security principals |
| `Claims` | `"Cl"` | Claims dictionary |
| `Actual` | `"Ac"` | Actual principal (who performed action) |
| `Effective` | `"Ef"` | Effective principal (impersonated identity) |
| `Type` | `"Ty"` | SecurityContextType |

#### PerspectiveScope Properties

| Short | Full Property |
|-------|---------------|
| `t` | TenantId |
| `u` | UserId |
| `c` | CustomerId |
| `o` | OrganizationId |
| `ap` | AllowedPrincipals |
| `ex` | Extensions |

### Wire Format Examples

```json{title="Wire Format Examples" description="Demonstrates wire Format Examples" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Wire", "Format"]}
// Change TenantId only:
{"v":{"Sc":{"t":"new-tenant"}}}

// Replace all Roles:
{"c":{"Ro":{"s":["Admin","User"]}}}

// Remove 2 roles, add 3 roles:
{"c":{"Ro":{"r":["Guest","Temp"],"a":["Admin","Manager","Supervisor"]}}}

// Mixed: change scope + modify roles + modify principals:
{"v":{"Sc":{"t":"x"}},"c":{"Ro":{"a":["Admin"]},"Pr":{"r":["group:old"],"a":["group:new"]}}}

// Nothing changed = null on hop (no scope property serialized)
```

## Migration Guide

### From Previous API

| Before (v0.x) | After (v1.0.0) |
|---------------|----------------|
| `_dispatcher.AsSystem().SendAsync(cmd)` | `_dispatcher.AsSystem().KeepTenant().SendAsync(cmd)` |
| `_dispatcher.AsSystem().WithTenant(id).SendAsync(cmd)` | `_dispatcher.AsSystem().ForTenant(id).SendAsync(cmd)` |
| `_dispatcher.RunAs(id).SendAsync(cmd)` | `_dispatcher.RunAs(id).KeepTenant().SendAsync(cmd)` |
| `_dispatcher.RunAs(id).WithTenant(tid).SendAsync(cmd)` | `_dispatcher.RunAs(id).ForTenant(tid).SendAsync(cmd)` |

For cross-tenant operations (rare):
```csharp{title="From Previous API" description="For cross-tenant operations (rare):" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Previous", "API"]}
_dispatcher.AsSystem().ForAllTenants().SendAsync(cmd)
_dispatcher.RunAs(identity).ForAllTenants().SendAsync(cmd)
```

## Related Topics

- [Security Context Propagation](security-context-propagation.md) - End-to-end context flow
- [Message Security](message-security.md) - Security context establishment
- [Multi-Tenancy](multi-tenancy.md) - Tenant isolation patterns
