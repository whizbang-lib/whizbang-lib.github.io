---
title: AddPerspectiveServices
version: 1.0.0
category: DI
order: 3
description: >-
  Register all discovered Perspective implementations with the DI container
tags: 'di, dependency-injection, perspectives, service-registration'
codeReferences:
  - src/Whizbang.Generators/Templates/ServiceRegistrationsTemplate.cs
---

# AddPerspectiveServices

`AddPerspectiveServices` is a source-generated extension method that registers all discovered Perspective implementations with the dependency injection container.

## Signature

```csharp
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

```csharp{title="Register Perspective Services" description="Register all discovered Perspectives" category="DI" difficulty="BEGINNER" tags=["DI", "Perspectives"]}
var builder = WebApplication.CreateBuilder(args);

// Register all discovered Perspective implementations
builder.Services.AddPerspectiveServices();
```

## With Options

```csharp{title="Register with Options" description="Customize Perspective registration" category="DI" difficulty="BEGINNER" tags=["DI", "Perspectives", "Options"]}
// Disable self-registration
builder.Services.AddPerspectiveServices(options =>
    options.IncludeSelfRegistration = false);
```

## What Gets Registered

The source generator discovers classes that:
- Implement `IPerspective<TEvent>` or derived interfaces
- Are not abstract
- Have accessible constructors

For each discovered Perspective, it generates:

```csharp{title="Generated Registration" description="Example of generated Perspective registration" category="DI" difficulty="INTERMEDIATE" tags=["DI", "SourceGenerator"]}
// Interface registration
services.AddScoped<IOrderPerspective, OrderPerspective>();

// Self-registration (when IncludeSelfRegistration = true)
services.AddScoped<OrderPerspective>();
```

## Registration Lifetime

All Perspectives are registered as **Scoped** services:
- Matches DbContext lifetime
- Fresh instance per request/scope
- Proper cleanup after scope disposal

## Example Perspective

```csharp{title="Example Perspective Implementation" description="A Perspective that gets discovered and registered" category="Domain Logic" difficulty="INTERMEDIATE" tags=["Perspectives", "EventSourcing"]}
public interface IOrderPerspective : IPerspective<OrderCreated>, IPerspective<OrderShipped> {
  Task<OrderSummary?> GetOrderAsync(OrderId orderId, CancellationToken ct);
}

public class OrderPerspective : IOrderPerspective {
  private readonly AppDbContext _db;

  public OrderPerspective(AppDbContext db) {
    _db = db;
  }

  public async Task HandleAsync(OrderCreated @event, CancellationToken ct) {
    _db.OrderSummaries.Add(new OrderSummary { ... });
    await _db.SaveChangesAsync(ct);
  }

  public async Task HandleAsync(OrderShipped @event, CancellationToken ct) {
    var order = await _db.OrderSummaries.FindAsync(@event.OrderId, ct);
    order.Status = OrderStatus.Shipped;
    await _db.SaveChangesAsync(ct);
  }

  public Task<OrderSummary?> GetOrderAsync(OrderId orderId, CancellationToken ct) =>
    _db.OrderSummaries.FirstOrDefaultAsync(o => o.Id == orderId, ct);
}
```

The generator automatically discovers `OrderPerspective` and generates registration code.

## Combining with Other Registrations

```csharp{title="Full Registration Setup" description="Complete DI setup with Perspectives" category="DI" difficulty="INTERMEDIATE" tags=["DI", "Setup"]}
var builder = WebApplication.CreateBuilder(args);

// Database
builder.Services.AddDbContext<AppDbContext>(...);

// Core Whizbang
builder.Services.AddWhizbang();

// Perspective message handlers (for dispatch routing)
builder.Services.AddWhizbangPerspectives();

// Generated service registrations
builder.Services.AddPerspectiveServices();  // DI registration
builder.Services.AddLensServices();         // Or use AddAllWhizbangServices()
```

## See Also

- [ServiceRegistrationOptions](service-registration-options) - Configuration options
- [ServiceRegistrationExtensions](service-registration) - Parent class
- [AddLensServices](lens-services) - Register Lens services
- [AddAllWhizbangServices](all-services) - Register all services
- [Perspectives](../components/perspectives) - Understanding Perspectives
