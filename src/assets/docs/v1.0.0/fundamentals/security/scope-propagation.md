---
title: Scope Propagation
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Core Concepts
order: 8
description: >-
  Delta-based scope propagation across message hops with explicit tenant strategy enforcement for system and impersonation operations.
tags: 'security, scope, tenant, multi-tenancy, system-operations, impersonation, delta, wire-format, scope-extensions, claim-propagation'
codeReferences:
  - src/Whizbang.Core/Security/ScopeDelta.cs
  - src/Whizbang.Core/Security/ScopePropJsonConverter.cs
  - src/Whizbang.Core/Dispatch/DispatcherSecurityExtensions.cs
  - src/Whizbang.Core/Dispatch/DispatcherSecurityBuilder.cs
  - src/Whizbang.Core/Dispatch/SystemDispatcherBuilder.cs
  - src/Whizbang.Core/Dispatch/ImpersonationDispatcherBuilder.cs
  - src/Whizbang.Core/Observability/MessageEnvelope.cs
  - src/Whizbang.Core/Lenses/TenantConstants.cs
  - src/Whizbang.Core/Lenses/PerspectiveScope.cs
  - src/Whizbang.Core/Security/HopScope.cs
  - src/Whizbang.Core/Security/SecurityExtraction.cs
  - src/Whizbang.Transports.HotChocolate/Middleware/WhizbangScopeMiddleware.cs
testReferences:
  - tests/Whizbang.Core.Tests/Security/ScopeDeltaTests.cs
  - tests/Whizbang.Core.Tests/Security/ScopeDeltaApplyToTests.cs
  - tests/Whizbang.Core.Tests/Security/ScopeDeltaExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Security/ScopePropJsonConverterTests.cs
  - tests/Whizbang.Core.Tests/Dispatch/DispatcherSecurityBuilderTests.cs
  - tests/Whizbang.Core.Tests/Dispatch/SystemDispatcherBuilderTests.cs
  - tests/Whizbang.Core.Tests/Dispatch/ImpersonationDispatcherBuilderTests.cs
  - tests/Whizbang.Core.Tests/Security/HopScopeTests.cs
  - tests/Whizbang.Core.Tests/Security/HopScopeTwoHopWireTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/HopScopeDispatchParityTests.cs
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/ScopeHopPropagationTests.cs
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/WhizbangScopeMiddlewareTests.cs
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/HotChocolateOptionsConfigurationBindingTests.cs
lastMaintainedCommit: '01f07906'
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

```csharp{title="System Operations" description="Use AsSystem() for timer/scheduler jobs, background workers, or elevated system operations:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "System", "Operations"] tests=["SystemDispatcherBuilderTests.AsSystem_ForAllTenants_SetsTenantIdToAllTenantsConstantAsync", "SystemDispatcherBuilderTests.AsSystem_ForTenant_SetsExplicitTenantIdAsync", "SystemDispatcherBuilderTests.AsSystem_KeepTenant_PreservesAmbientTenantIdAsync", "SystemDispatcherBuilderTests.SystemDispatcherBuilder_DoesNotHaveSendAsyncMethodAsync"]}
// Cross-tenant system operation (use sparingly)
await _dispatcher.AsSystem().ForAllTenants().SendAsync(new ReindexAllTenantsCommand());

// Tenant-scoped system operation (most common)
await _dispatcher.AsSystem().ForTenant("tenant-123").SendAsync(new TenantMaintenanceCommand());

// Keep ambient tenant from current context
await _dispatcher.AsSystem().KeepTenant().SendAsync(new ProcessPendingItemsCommand());

// COMPILE ERROR: Must choose tenant strategy first!
// await _dispatcher.AsSystem().SendAsync(command);
```

Background work often has to **read** in a tenant before it knows what to dispatch, for example a
maintenance worker reading one tenant's records through a tenant-scoped lens. `RunAsync` runs any work
under the same explicit context the dispatch verbs use, and restores the caller's context afterwards,
whether the work completes or throws:

```csharp{title="Running work in a tenant as the system" description="Reads through tenant-scoped lenses from a background worker with no ambient tenant" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "System", "Operations"] tests=["DispatcherSecurityBuilderRunTests.RunAsync_ForTenant_WorkSeesThatTenantAsTheSystemAsync", "DispatcherSecurityBuilderRunTests.RunAsync_WorkThrows_TheCallersContextIsStillRestoredAsync"]}
var pending = await _dispatcher.AsSystem().ForTenant(tenantId)
  .RunAsync(ct => _repository.CountPendingAsync(ct), cancellationToken);
```

### Impersonation Operations

Use `RunAs()` when an admin or service performs operations on behalf of another user:

```csharp{title="Impersonation Operations" description="Use RunAs() when an admin or service performs operations on behalf of another user:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Impersonation", "Operations"] tests=["ImpersonationDispatcherBuilderTests.RunAs_ForTenant_SetsExplicitTenantIdAsync", "ImpersonationDispatcherBuilderTests.RunAs_KeepTenant_PreservesAmbientTenantIdAsync", "ImpersonationDispatcherBuilderTests.RunAs_ForAllTenants_SetsTenantIdToAllTenantsConstantAsync"]}
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

```csharp{title="TenantConstants" description="The `TenantConstants." category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "TenantConstants"] tests=["SystemDispatcherBuilderTests.TenantConstants_AllTenants_IsAsteriskAsync"]}
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

```csharp{title="Delta Storage on Message Hops" description="Each MessageHop can carry a ScopeDelta containing only the changes from the previous hop:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Delta", "Storage"] tests=["ScopeDeltaTests.ScopeDelta_Serialization_UsesShortPropertyNamesAsync", "ScopeDeltaTests.ScopeDelta_WithValues_HasChangesAsync", "ScopeDeltaTests.ScopeDelta_WithCollections_HasChangesAsync"]}
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

```csharp{title="Collection Changes" description="Collections (Roles, Permissions, SecurityPrincipals) support three operations:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Collection", "Changes"] tests=["ScopeDeltaTests.CollectionChanges_Serialization_UsesShortPropertyNamesAsync", "ScopeDeltaTests.CollectionChanges_WithSet_HasChangesAsync", "ScopeDeltaTests.CollectionChanges_WithAdd_HasChangesAsync", "ScopeDeltaTests.CollectionChanges_WithRemove_HasChangesAsync"]}
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

```csharp{title="Rebuilding Full Scope" description="To get the current full scope, call GetCurrentScope() on the envelope:" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Rebuilding", "Full"] unverified="Illustrative pseudocode for MessageEnvelope.GetCurrentScope; MessageEnvelopeTests is outside this page's test references"}
var envelope = /* received message envelope */;
var fullScope = envelope.GetCurrentScope();  // MessageEnvelope.GetCurrentScope() → ScopeContext?

// Now you can check permissions, roles, etc.
if (fullScope?.HasPermission(Permission.Write("orders")) == true) {
  // Authorized
}
```

## Scope Extensions and Claims Across Services {#extensions-and-claims}

{verified: ScopeHopPropagationTests.ExtensionMappedAtTheEdge_ReachesAReceptorTwoHopsAway_AndTheEventItEmitsAsync, HopScopeTwoHopWireTests.ExtensionAndListedClaim_ReachAReceptorTwoHopsAway_AndTheEventItEmitsAsync}

A fact established at the HTTP edge, such as "this caller is acting as an administrator", often decides what a receptor several services downstream may do. Map the fact into the scope as an **extension** at the edge, and it travels on every hop with the rest of the scope: a receptor in another service reads it from `IScopeContext.Scope.Extensions`, and every event that receptor emits carries it on. Claims are different: a claim crosses a hop only when its type is listed in `PropagatedClaimTypes`. The full rules are in [Message Security: Hop Scope](message-security.md#hop-scope).

### 1. Map the claim at the edge

In the service that receives the HTTP request, map the caller's claim to a scope extension with `ExtensionClaimMappings` (claim type to extension key), and list any claim a downstream service needs as a claim with `PropagatedClaimTypes`:

```csharp{title="Map a claim to a scope extension at the HTTP edge" description="The edge service maps the acting_admin claim to the acting-admin scope extension and opts the department claim in for propagation; every other claim stays in the edge service." category="Configuration" difficulty="INTERMEDIATE" tags=["Security", "Scope", "Extensions", "Claims", "Propagation"] filename="Program.cs" usingStatements=["Whizbang.Transports.HotChocolate.Middleware"] tests=["ScopeHopPropagationTests.ExtensionMappedAtTheEdge_ReachesAReceptorTwoHopsAway_AndTheEventItEmitsAsync", "WhizbangScopeMiddlewareTests.InvokeAsync_PropagatedClaimTypes_AreListedOnTheScopeContextAsync"]}
builder.Services.AddWhizbangScope(options => {
    // The caller's acting_admin claim becomes the acting-admin scope extension,
    // which travels with the scope to every downstream service
    options.ExtensionClaimMappings["acting_admin"] = "acting-admin";

    // The department claim's value crosses each hop; every other claim
    // (tokens, email, ...) stays in this service
    options.PropagatedClaimTypes.Add("department");
});

var app = builder.Build();
app.UseWhizbangScope();
```

The same settings can come from configuration:

```json{title="Scope mapping and claim propagation in appsettings.json" description="Binds the extension mapping and the propagated claim list from the Whizbang:Scope section." category="Configuration" difficulty="BEGINNER" tags=["Security", "Scope", "Configuration", "Claims"] tests=["HotChocolateOptionsConfigurationBindingTests.Scope_EveryKeyBindsAsync"]}
{
  "Whizbang": {
    "Scope": {
      "ExtensionClaimMappings": { "acting_admin": "acting-admin" },
      "PropagatedClaimTypes": [ "department" ]
    }
  }
}
```

:::warning
List a claim in `PropagatedClaimTypes` only when a downstream service needs it. The value of each listed claim is written into message metadata on every hop, and so into the stored outbox, inbox and event rows. Never list an access token or a claim that holds personal data.
:::

### 2. Read it in a receptor in another service

A request in the edge service dispatches a command; a receptor in another service handles it. That receptor reads the extension and the listed claim from its scope context, exactly as the edge established them:

```csharp{title="Read a scope extension in a receptor in another service" description="A receptor two services from the HTTP edge reads the acting-admin extension and the propagated department claim from IScopeContext; the event it returns carries both on its hop." category="Messaging" difficulty="INTERMEDIATE" tags=["Security", "Scope", "Extensions", "Receptors", "Claims"] filename="ApproveRefundReceptor.cs" tests=["HopScopeTwoHopWireTests.ExtensionAndListedClaim_ReachAReceptorTwoHopsAway_AndTheEventItEmitsAsync", "ScopeHopPropagationTests.ExtensionMappedAtTheEdge_ReachesAReceptorTwoHopsAway_AndTheEventItEmitsAsync", "HopScopeDispatchParityTests.LocalReceptor_SeesTheExtensionAndTheEventItEmitsCarriesItAsync"]}
using System;
using System.Threading;
using System.Threading.Tasks;
using Whizbang.Core;
using Whizbang.Core.Security;

namespace Billing.Receptors;

public class ApproveRefundReceptor : IReceptor<ApproveRefund, RefundApproved> {
    private readonly IScopeContextAccessor _scopeContextAccessor;

    public ApproveRefundReceptor(IScopeContextAccessor scopeContextAccessor) {
        _scopeContextAccessor = scopeContextAccessor;
    }

    public ValueTask<RefundApproved> HandleAsync(ApproveRefund message, CancellationToken cancellationToken = default) {
        var context = _scopeContextAccessor.Current
            ?? throw new InvalidOperationException("ApproveRefund arrived without a scope");

        // The extension the HTTP edge mapped from the caller's claim, services upstream
        var actingAdmin = context.Scope.GetValue("acting-admin") == "true";

        // A listed claim; a claim that was not listed never reaches this service
        context.Claims.TryGetValue("department", out var department);

        // The event returned here carries the same scope and claim on its hop
        return ValueTask.FromResult(new RefundApproved(message.RefundId, actingAdmin, department));
    }
}
```

`context.Scope.Extensions` holds every extension as a list of key and value pairs; `GetValue(key)` returns one by key, or `null` when the request did not set it.

### What does not travel

- **Unlisted claims.** A claim whose type is not in `PropagatedClaimTypes` stays in the service that read it.
- **Another identity's scope.** A message dispatched with an explicit message context for a different tenant or user carries that identity's ids and none of the current request's extensions or claims ([details](message-security.md#hop-scope-same-identity)).
- **A non-propagating scope.** A scope context created with `ShouldPropagate = false` lends only the tenant and user ids.
- **Two stored-event read-back paths** rebuild only the tenant and user ids for now ([known gap](message-security.md#hop-scope-known-gap), tracked as [whizbang-lib/whizbang#1855](https://github.com/whizbang-lib/whizbang/issues/1855)).

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

```json{title="Wire Format Examples" description="Wire Format Examples" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Fundamentals", "Security", "Wire", "Format"]}
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
```csharp{title="From Previous API" description="For cross-tenant operations (rare):" category="Best-Practices" difficulty="BEGINNER" tags=["Fundamentals", "Security", "Previous", "API"] tests=["SystemDispatcherBuilderTests.AsSystem_ForAllTenants_SetsTenantIdToAllTenantsConstantAsync", "ImpersonationDispatcherBuilderTests.RunAs_ForAllTenants_SetsTenantIdToAllTenantsConstantAsync"]}
_dispatcher.AsSystem().ForAllTenants().SendAsync(cmd)
_dispatcher.RunAs(identity).ForAllTenants().SendAsync(cmd)
```

## Related Topics

- [Security Context Propagation](security-context-propagation.md) - End-to-end context flow
- [Message Security](message-security.md) - Security context establishment
- [Multi-Tenancy](multi-tenancy.md) - Tenant isolation patterns
- [Message Security: Hop Scope](message-security.md#hop-scope) - What a message's hop scope carries and which claims cross
