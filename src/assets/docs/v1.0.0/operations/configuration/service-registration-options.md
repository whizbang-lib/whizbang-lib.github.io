---
title: ServiceRegistrationOptions
version: 1.0.0
category: DI
order: 1
description: >-
  Configuration options for Whizbang service registration behavior, including
  self-registration settings
tags: 'di, dependency-injection, service-registration, options, configuration'
codeReferences:
  - src/Whizbang.Generators/Templates/ServiceRegistrationsTemplate.cs
lastMaintainedCommit: '01f07906'
---

# ServiceRegistrationOptions

`ServiceRegistrationOptions` configures how Whizbang registers discovered services (Perspectives and Lenses) with the dependency injection container.

## Overview

When Whizbang's source generator discovers Perspective and Lens implementations, it generates extension methods to register them with your DI container. `ServiceRegistrationOptions` controls this registration behavior.

## Properties

### IncludeSelfRegistration

| Property | Type | Default |
|----------|------|---------|
| `IncludeSelfRegistration` | `bool` | `true` |

Controls whether concrete types are registered as themselves in addition to their interfaces.

**When enabled (default)**:
```csharp{title="IncludeSelfRegistration" description="When enabled (default):" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Configuration", "IncludeSelfRegistration"]}
// Both registrations are made
services.AddScoped<IOrderLens, OrderLens>();  // Interface registration
services.AddScoped<OrderLens>();               // Self-registration
```

**When disabled**:
```csharp{title="IncludeSelfRegistration - registration" description="When disabled:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Configuration", "IncludeSelfRegistration"]}
// Only interface registration
services.AddScoped<IOrderLens, OrderLens>();
```

## Usage

### Default Behavior

```csharp{title="Default Registration" description="Register services with default options" category="DI" difficulty="BEGINNER" tags=["DI", "ServiceRegistration"]}
// Uses default options (IncludeSelfRegistration = true)
services.AddPerspectiveServices();
services.AddLensServices();
```

### Customized Registration

```csharp{title="Custom Registration Options" description="Disable self-registration" category="DI" difficulty="BEGINNER" tags=["DI", "ServiceRegistration", "Options"]}
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
  services.AddScoped<IOrderLens, OrderLens>();

  // Self-registration (conditional)
  if (options.IncludeSelfRegistration) {
    services.AddScoped<OrderLens>();
  }

  return services;
}
```

## See Also

- [ServiceRegistrationExtensions](service-registration) - Extension methods for service registration
- [AddPerspectiveServices](perspective-services) - Register Perspective services
- [AddLensServices](lens-services) - Register Lens services
- [AddAllWhizbangServices](all-services) - Register all Whizbang services
