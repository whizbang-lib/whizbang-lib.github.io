---
title: AddAllWhizbangServices
version: 1.0.0
category: DI
order: 5
description: >-
  Register all discovered Perspective and Lens implementations with a single
  method call
tags: 'di, dependency-injection, service-registration, convenience'
codeReferences:
  - src/Whizbang.Generators/Templates/ServiceRegistrationsTemplate.cs
---

# AddAllWhizbangServices

`AddAllWhizbangServices` is a convenience method that registers all discovered Perspective and Lens implementations with the dependency injection container in a single call.

## Signature

```csharp{title="Signature" description="Signature" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Configuration", "Signature"]}
public static IServiceCollection AddAllWhizbangServices(
    this IServiceCollection services,
    Action<ServiceRegistrationOptions>? configure = null)
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `services` | `IServiceCollection` | The service collection to add registrations to |
| `configure` | `Action<ServiceRegistrationOptions>?` | Optional configuration action |

## Returns

`IServiceCollection` - The service collection for method chaining.

## Behavior

This method is equivalent to calling both registration methods with the same options:

```csharp{title="Behavior" description="This method is equivalent to calling both registration methods with the same options:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Configuration", "Behavior"]}
services.AddPerspectiveServices(configure);
services.AddLensServices(configure);
```

## Basic Usage

```csharp{title="Register All Services" description="Register all Whizbang services at once" category="DI" difficulty="BEGINNER" tags=["DI", "ServiceRegistration"]}
var builder = WebApplication.CreateBuilder(args);

// Register all discovered Perspectives and Lenses
builder.Services.AddAllWhizbangServices();
```

## With Options

```csharp{title="Register with Options" description="Configure all service registrations" category="DI" difficulty="BEGINNER" tags=["DI", "Options"]}
// Disable self-registration for all services
builder.Services.AddAllWhizbangServices(options =>
    options.IncludeSelfRegistration = false);
```

## Complete Setup Example

```csharp{title="Full Application Setup" description="Complete DI configuration with Whizbang" category="DI" difficulty="INTERMEDIATE" tags=["DI", "Setup", "Example"]}
var builder = WebApplication.CreateBuilder(args);

// 1. Configure database
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

// 2. Add core Whizbang services
builder.Services.AddWhizbang(options => {
  options.Tags.UseHook<NotificationTagAttribute, SignalRNotificationHook>();
});

// 3. Register Perspective message handlers (for dispatch routing)
builder.Services.AddWhizbangPerspectives();

// 4. Register generated service registrations (for DI resolution)
builder.Services.AddAllWhizbangServices();

var app = builder.Build();
```

## When to Use

**Use `AddAllWhizbangServices`** when:
- You want all Perspectives and Lenses registered
- You want consistent options for all services
- You prefer a single registration call

**Use individual methods** when:
- You need different options for Perspectives vs Lenses
- You only want to register one type of service
- You need more granular control

```csharp{title="Individual Registration" description="Register services separately with different options" category="DI" difficulty="INTERMEDIATE" tags=["DI", "Options"]}
// Different options for each service type
builder.Services.AddPerspectiveServices(options =>
    options.IncludeSelfRegistration = true);

builder.Services.AddLensServices(options =>
    options.IncludeSelfRegistration = false);
```

## Method Chaining

The method returns `IServiceCollection` for fluent configuration:

```csharp{title="Method Chaining" description="Chain service registration methods" category="DI" difficulty="BEGINNER" tags=["DI", "Fluent"]}
builder.Services
    .AddWhizbang()
    .AddWhizbangPerspectives()
    .AddAllWhizbangServices();
```

## See Also

- [ServiceRegistrationOptions](service-registration-options) - Configuration options
- [ServiceRegistrationExtensions](service-registration) - Parent class
- [AddPerspectiveServices](perspective-services) - Register only Perspectives
- [AddLensServices](lens-services) - Register only Lenses
- [WhizbangCoreOptions](./whizbang-options) - Core configuration
