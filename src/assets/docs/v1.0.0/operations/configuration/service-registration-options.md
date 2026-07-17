---
title: ServiceRegistrationOptions
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: DI
order: 1
description: >-
  Configuration options for Whizbang service registration behavior, including
  self-registration settings
tags: 'di, dependency-injection, service-registration, options, configuration'
codeReferences:
  - src/Whizbang.Core/Configuration/ServiceRegistrationOptions.cs
  - src/Whizbang.Core/ServiceRegistrationCallbacks.cs
  - src/Whizbang.Generators/Templates/ServiceRegistrationsTemplate.cs
testReferences:
  - tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# ServiceRegistrationOptions

`ServiceRegistrationOptions` configures how Whizbang registers discovered services (Perspectives and Lenses) with the dependency injection container.

## Overview

When Whizbang's source generator discovers Perspective and Lens implementations, it generates extension methods to register them with your DI container. `ServiceRegistrationOptions` controls this registration behavior.

Two classes with this name exist and mirror each other:

- **`Whizbang.Core.Configuration.ServiceRegistrationOptions`** — exposed as `options.Services` on [`WhizbangCoreOptions`](whizbang-options). Used by the auto-registration path: `AddWhizbang()` invokes the source-generated `ServiceRegistrationCallbacks` with these options, so discovered services are registered without any explicit call.
- **`Whizbang.Core.Generated.ServiceRegistrationOptions`** — generated into your assembly for use with the explicit `AddLensServices` / `AddPerspectiveServices` / `AddAllWhizbangServices` methods.

Both carry the same single property.

## Properties

### IncludeSelfRegistration

| Property | Type | Default |
|----------|------|---------|
| `IncludeSelfRegistration` | `bool` | `true` |

Controls whether concrete types are registered as themselves in addition to their interfaces. All generated registrations are **Transient**.

**When enabled (default)**:
```csharp{title="IncludeSelfRegistration" description="When enabled (default):" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Configuration", "IncludeSelfRegistration"]}
// Both registrations are made
services.AddTransient<IOrderLens, OrderLens>();  // Interface registration
services.AddTransient<OrderLens>();               // Self-registration
```

**When disabled**:
```csharp{title="IncludeSelfRegistration - registration" description="When disabled:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Configuration", "IncludeSelfRegistration"]}
// Only interface registration
services.AddTransient<IOrderLens, OrderLens>();
```

## Usage

### Default Behavior (Auto-Registration)

`AddWhizbang()` auto-registers all discovered services with default options — no explicit call needed:

```csharp{title="Default Registration" description="Auto-registration via AddWhizbang" category="DI" difficulty="BEGINNER" tags=["DI", "ServiceRegistration"]}
// Auto-registers discovered Lenses and Perspectives
// (IncludeSelfRegistration = true)
services.AddWhizbang();
```

### Customized Registration

Configure the auto-registration path through `options.Services`:

```csharp{title="Configure via AddWhizbang" description="Disable self-registration for auto-registered services" category="DI" difficulty="BEGINNER" tags=["DI", "ServiceRegistration", "Options"]}
services.AddWhizbang(options => {
  options.Services.IncludeSelfRegistration = false;  // Only register interfaces
});
```

Or call the generated extension methods explicitly:

```csharp{title="Custom Registration Options" description="Disable self-registration via explicit methods" category="DI" difficulty="BEGINNER" tags=["DI", "ServiceRegistration", "Options"]}
// Disable self-registration for all services
services.AddPerspectiveServices(options => options.IncludeSelfRegistration = false);
services.AddLensServices(options => options.IncludeSelfRegistration = false);

// Or use the combined method
services.AddAllWhizbangServices(options => options.IncludeSelfRegistration = false);
```

## When to Disable Self-Registration

**Keep enabled (default)** when:
- You inject concrete types directly
- You want flexibility in how services are resolved
- Testing scenarios require concrete type resolution

**Disable** when:
- You want to enforce interface-only injection
- You want to minimize service registrations
- Your coding standards require interface-based dependencies

## Generated Code

The source generator produces code similar to:

```csharp{title="Generated Registration Code" description="Example of generated service registration" category="DI" difficulty="INTERMEDIATE" tags=["DI", "SourceGenerator"]}
public static IServiceCollection AddLensServices(
    this IServiceCollection services,
    Action<ServiceRegistrationOptions>? configure = null) {

  var options = new ServiceRegistrationOptions();
  configure?.Invoke(options);

  // Interface registration (always)
  services.AddTransient<IOrderLens, OrderLens>();

  // Self-registration (conditional)
  if (options.IncludeSelfRegistration) {
    services.AddTransient<OrderLens>();
  }

  return services;
}
```

The generator also emits a `[ModuleInitializer]` that wires these methods into `ServiceRegistrationCallbacks`, which is how `AddWhizbang()` invokes them automatically when your assembly loads.

## See Also

- [ServiceRegistrationExtensions](service-registration) - Extension methods for service registration
- [AddPerspectiveServices](perspective-services) - Register Perspective services
- [AddLensServices](lens-services) - Register Lens services
- [AddAllWhizbangServices](all-services) - Register all Whizbang services
