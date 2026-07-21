---
title: AddPerspectiveServices
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: DI
order: 3
description: >-
  Register all discovered Perspective implementations with the DI container
tags: 'di, dependency-injection, perspectives, service-registration'
codeReferences:
  - src/Whizbang.Generators/Templates/ServiceRegistrationsTemplate.cs
  - src/Whizbang.Generators/ServiceRegistrationGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# AddPerspectiveServices

`AddPerspectiveServices` is a source-generated extension method that registers all discovered Perspective implementations with the dependency injection container.

:::updated
`AddWhizbang()` invokes this method automatically via `ServiceRegistrationCallbacks` — an explicit call is only needed when registering services without `AddWhizbang()`, or with different options.
:::

## Signature

```csharp{title="Signature" description="Signature" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Configuration", "Signature"]}
public static IServiceCollection AddPerspectiveServices(
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

## Basic Usage

```csharp{title="Register Perspective Services" description="Register all discovered Perspectives" category="DI" difficulty="BEGINNER" tags=["DI", "Perspectives"] unverified="DI registration call — the generator output is verified by ServiceRegistrationGeneratorTests"}
var builder = WebApplication.CreateBuilder(args);

// Register all discovered Perspective implementations
builder.Services.AddPerspectiveServices();
```

## With Options

```csharp{title="Register with Options" description="Customize Perspective registration" category="DI" difficulty="BEGINNER" tags=["DI", "Perspectives", "Options"] unverified="DI registration call — the generator output is verified by ServiceRegistrationGeneratorTests"}
// Disable self-registration
builder.Services.AddPerspectiveServices(options =>
    options.IncludeSelfRegistration = false);
```

## What Gets Registered

The source generator discovers classes that:
- Implement `IPerspectiveFor<TModel, TEvent...>` or `IPerspectiveWithActionsFor<TModel, TEvent...>` — either directly (with closed generic arguments) or through a user-defined interface that extends one of them
- Are not abstract

For each discovered Perspective, it generates:

```csharp{title="Generated Registration" description="Example of generated Perspective registration" category="DI" difficulty="INTERMEDIATE" tags=["DI", "SourceGenerator"] tests=["ServiceRegistrationGeneratorTests.Generator_DirectPerspectiveImplementation_RegistersAgainstWhizbangInterfaceAsync", "ServiceRegistrationGeneratorTests.Generator_SelfRegistration_EnabledByDefault_RegistersBothAsync"]}
// Interface registration
services.AddTransient<IPerspectiveFor<OrderSummary, OrderCreated, OrderShipped>, OrderSummaryPerspective>();

// Self-registration (when IncludeSelfRegistration = true)
services.AddTransient<OrderSummaryPerspective>();
```

When the class implements a user-defined interface extending a Whizbang perspective interface, the registration targets the user interface instead.

## Registration Lifetime

All Perspectives are registered as **Transient** services:
- Fresh instance per resolution
- No accidental state sharing — perspectives are pure functions
- Any scoped dependencies come from the resolving scope

## Example Perspective

Perspectives are **pure functions** — each `Apply` method takes the current read-model state and an event, and returns the new state. No I/O, no injected services:

```csharp{title="Example Perspective Implementation" description="A Perspective that gets discovered and registered" category="Domain Logic" difficulty="INTERMEDIATE" tags=["Perspectives", "EventSourcing"]}
public class OrderSummaryPerspective :
  IPerspectiveFor<OrderSummary, OrderCreated, OrderShipped> {

  public OrderSummary Apply(OrderSummary currentData, OrderCreated @event) =>
    new OrderSummary {
      OrderId = @event.OrderId,
      CustomerId = @event.CustomerId,
      Status = OrderStatus.Created,
      CreatedAt = @event.CreatedAt
    };

  public OrderSummary Apply(OrderSummary currentData, OrderShipped @event) =>
    currentData with {
      Status = OrderStatus.Shipped,
      ShippedAt = @event.ShippedAt
    };
}
```

The generator automatically discovers `OrderSummaryPerspective` and generates registration code.

## Combining with Other Registrations

```csharp{title="Full Registration Setup" description="Complete DI setup with Perspectives" category="DI" difficulty="INTERMEDIATE" tags=["DI", "Setup"] unverified="DI registration call — the generator output is verified by ServiceRegistrationGeneratorTests"}
var builder = WebApplication.CreateBuilder(args);

// Database
builder.Services.AddDbContext<AppDbContext>(...);

// Core Whizbang (auto-registers discovered Perspectives and Lenses)
builder.Services.AddWhizbang();

// Perspective runners (for perspective materialization)
builder.Services.AddWhizbangPerspectives();

// Explicit generated registrations — only when bypassing AddWhizbang()
builder.Services.AddPerspectiveServices();
builder.Services.AddLensServices();         // Or use AddAllWhizbangServices()
```

## See Also

- [ServiceRegistrationOptions](service-registration-options) - Configuration options
- [ServiceRegistrationExtensions](service-registration) - Parent class
- [AddLensServices](lens-services) - Register Lens services
- [AddAllWhizbangServices](all-services) - Register all services
- [Perspectives](../../fundamentals/perspectives/perspectives) - Understanding Perspectives
