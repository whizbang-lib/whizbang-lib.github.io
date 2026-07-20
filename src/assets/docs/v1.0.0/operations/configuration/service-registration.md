---
title: ServiceRegistrationExtensions
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: DI
order: 2
description: >-
  Source-generated extension methods for registering Whizbang Perspectives and
  Lenses with the DI container
tags: 'di, dependency-injection, service-registration, extension-methods, source-generator'
codeReferences:
  - src/Whizbang.Generators/Templates/ServiceRegistrationsTemplate.cs
  - src/Whizbang.Generators/ServiceRegistrationGenerator.cs
  - src/Whizbang.Core/ServiceRegistrationCallbacks.cs
testReferences:
  - tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# ServiceRegistrationExtensions

`ServiceRegistrationExtensions` is a source-generated static class containing extension methods to register discovered Perspective and Lens implementations with the dependency injection container.

## Overview

Whizbang's source generator scans your codebase for:
- Classes implementing user interfaces that extend `IPerspectiveFor<...>` / `IPerspectiveWithActionsFor<...>` (or implementing those Whizbang interfaces directly with closed generic arguments)
- Classes implementing user interfaces that extend `ILensQuery` (or implementing `ILensQuery<T>` directly)

It then generates `ServiceRegistrationExtensions` with methods to register all discovered implementations as **Transient** services.

The generator also emits a `[ModuleInitializer]` that wires these methods into `ServiceRegistrationCallbacks`, so `AddWhizbang()` invokes them **automatically** when your assembly loads — the explicit methods below are only needed when you want to register services without calling `AddWhizbang()`, or with different options.

## Generated Methods

| Method | Description |
|--------|-------------|
| [`AddPerspectiveServices`](perspective-services) | Registers all discovered Perspectives |
| [`AddLensServices`](lens-services) | Registers all discovered Lenses |
| [`AddAllWhizbangServices`](all-services) | Registers both Perspectives and Lenses |

## Basic Usage

```csharp{title="Basic Service Registration" description="Register all Whizbang services" category="DI" difficulty="BEGINNER" tags=["DI", "ServiceRegistration"] unverified="DI registration call — the generator output is verified by ServiceRegistrationGeneratorTests"}
var builder = WebApplication.CreateBuilder(args);

// Registers core Whizbang services AND auto-invokes the generated
// service registrations for discovered Perspectives and Lenses
builder.Services.AddWhizbang();

// Explicit call — only needed when bypassing AddWhizbang()
// or re-registering with different options
builder.Services.AddAllWhizbangServices();
```

## Registration Order

The recommended registration order is:

```csharp{title="Recommended Registration Order" description="Full Whizbang DI setup" category="DI" difficulty="BEGINNER" tags=["DI", "Setup"] unverified="DI registration call — the generator output is verified by ServiceRegistrationGeneratorTests"}
var builder = WebApplication.CreateBuilder(args);

// 1. Database context
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString));

// 2. Core Whizbang services (auto-registers discovered services)
builder.Services.AddWhizbang();

// 3. Perspective runner registrations (for perspective materialization)
builder.Services.AddWhizbangPerspectives();
```

## With Options

All registration methods accept an optional configuration action:

```csharp{title="Registration with Options" description="Configure service registration behavior" category="DI" difficulty="INTERMEDIATE" tags=["DI", "Configuration"] unverified="DI registration call — the generator output is verified by ServiceRegistrationGeneratorTests"}
builder.Services.AddAllWhizbangServices(options => {
  // Disable self-registration (interface-only)
  options.IncludeSelfRegistration = false;
});
```

See [ServiceRegistrationOptions](service-registration-options) for available options.

## Service Lifetime

All services are registered as **Transient**:

```csharp{title="Service Lifetime" description="All discovered services are registered as Transient" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Configuration", "Service", "Lifetime"] tests=["ServiceRegistrationGeneratorTests.Generator_UserLensInterface_RegistersInterfaceToImplementationAsync"]}
// Generated registration
services.AddTransient<IOrderLens, OrderLens>();
```

This ensures:
- A fresh instance per resolution
- Scoped dependencies (like `DbContext`) are supplied by the resolving scope
- No accidental state sharing between resolutions

## Source Generation

The generator runs at compile-time and produces a file similar to:

```csharp{title="Generated Code Structure" description="Structure of generated ServiceRegistrationExtensions" category="DI" difficulty="INTERMEDIATE" tags=["SourceGenerator"] tests=["ServiceRegistrationGeneratorTests.Generator_CombinedLensAndPerspective_GeneratesBothMethodsAsync"]}
// <auto-generated/>
namespace Whizbang.Core.Generated;

/// <summary>
/// Extension methods for registering 3 discovered perspective service(s)
/// and 5 discovered lens service(s) with the DI container.
/// All services are registered as Transient.
/// </summary>
public static class ServiceRegistrationExtensions {
  public static IServiceCollection AddPerspectiveServices(...) { ... }
  public static IServiceCollection AddLensServices(...) { ... }
  public static IServiceCollection AddAllWhizbangServices(...) { ... }
}

// Plus a module initializer that wires the methods into
// ServiceRegistrationCallbacks so AddWhizbang() invokes them automatically
internal static class ServiceRegistrationInitializer {
  [ModuleInitializer]
  internal static void Initialize() { ... }
}
```

## See Also

- [ServiceRegistrationOptions](service-registration-options) - Configuration options
- [AddPerspectiveServices](perspective-services) - Register Perspective services
- [AddLensServices](lens-services) - Register Lens services
- [AddAllWhizbangServices](all-services) - Register all Whizbang services
- [Perspectives](../../fundamentals/perspectives/perspectives) - What Perspectives are
- [Lenses](../../fundamentals/lenses/lenses) - What Lenses are
