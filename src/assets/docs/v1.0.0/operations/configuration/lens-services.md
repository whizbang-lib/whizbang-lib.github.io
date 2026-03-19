---
title: AddLensServices
version: 1.0.0
category: DI
order: 4
description: >-
  Register all discovered Lens implementations with the DI container
tags: 'di, dependency-injection, lenses, service-registration, queries'
codeReferences:
  - src/Whizbang.Generators/Templates/ServiceRegistrationsTemplate.cs
---

# AddLensServices

`AddLensServices` is a source-generated extension method that registers all discovered Lens implementations with the dependency injection container.

## Signature

```csharp
public static IServiceCollection AddLensServices(
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

```csharp{title="Register Lens Services" description="Register all discovered Lenses" category="DI" difficulty="BEGINNER" tags=["DI", "Lenses"]}
var builder = WebApplication.CreateBuilder(args);

// Register all discovered Lens implementations
builder.Services.AddLensServices();
```

## With Options

```csharp{title="Register with Options" description="Customize Lens registration" category="DI" difficulty="BEGINNER" tags=["DI", "Lenses", "Options"]}
// Disable self-registration
builder.Services.AddLensServices(options =>
    options.IncludeSelfRegistration = false);
```

## What Gets Registered

The source generator discovers classes that:
- Implement `ILensQuery` interface
- Are not abstract
- Have accessible constructors

For each discovered Lens, it generates:

```csharp{title="Generated Registration" description="Example of generated Lens registration" category="DI" difficulty="INTERMEDIATE" tags=["DI", "SourceGenerator"]}
// Interface registration
services.AddScoped<IOrderLens, OrderLens>();

// Self-registration (when IncludeSelfRegistration = true)
services.AddScoped<OrderLens>();
```

## Registration Lifetime

All Lenses are registered as **Scoped** services:
- Matches DbContext lifetime
- Fresh instance per request/scope
- Proper cleanup after scope disposal

## Example Lens

```csharp{title="Example Lens Implementation" description="A Lens that gets discovered and registered" category="Domain Logic" difficulty="INTERMEDIATE" tags=["Lenses", "Queries", "CQRS"]}
public interface IOrderLens : ILensQuery {
  Task<OrderSummary?> GetByIdAsync(OrderId orderId, CancellationToken ct);
  Task<IReadOnlyList<OrderSummary>> GetByCustomerAsync(CustomerId customerId, CancellationToken ct);
  Task<IReadOnlyList<OrderSummary>> GetRecentAsync(int count, CancellationToken ct);
}

public class OrderLens : IOrderLens {
  private readonly AppDbContext _db;

  public OrderLens(AppDbContext db) {
    _db = db;
  }

  public Task<OrderSummary?> GetByIdAsync(OrderId orderId, CancellationToken ct) =>
    _db.OrderSummaries.FirstOrDefaultAsync(o => o.Id == orderId, ct);

  public Task<IReadOnlyList<OrderSummary>> GetByCustomerAsync(
      CustomerId customerId,
      CancellationToken ct) =>
    _db.OrderSummaries
       .Where(o => o.CustomerId == customerId)
       .OrderByDescending(o => o.CreatedAt)
       .ToListAsync(ct);

  public Task<IReadOnlyList<OrderSummary>> GetRecentAsync(int count, CancellationToken ct) =>
    _db.OrderSummaries
       .OrderByDescending(o => o.CreatedAt)
       .Take(count)
       .ToListAsync(ct);
}
```

The generator automatically discovers `OrderLens` and generates registration code.

## Using Lenses

After registration, inject Lenses into controllers, services, or GraphQL resolvers:

```csharp{title="Using an Injected Lens" description="Inject and use a Lens in a controller" category="API" difficulty="BEGINNER" tags=["Lenses", "Controller"]}
[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase {
  private readonly IOrderLens _orderLens;

  public OrdersController(IOrderLens orderLens) {
    _orderLens = orderLens;
  }

  [HttpGet("{id}")]
  public async Task<ActionResult<OrderSummary>> GetOrder(
      [FromRoute] OrderId id,
      CancellationToken ct) {

    var order = await _orderLens.GetByIdAsync(id, ct);
    return order is null ? NotFound() : Ok(order);
  }
}
```

## Combining with Other Registrations

```csharp{title="Full Registration Setup" description="Complete DI setup with Lenses" category="DI" difficulty="INTERMEDIATE" tags=["DI", "Setup"]}
var builder = WebApplication.CreateBuilder(args);

// Database
builder.Services.AddDbContext<AppDbContext>(...);

// Core Whizbang
builder.Services.AddWhizbang();

// Generated service registrations
builder.Services.AddPerspectiveServices();
builder.Services.AddLensServices();

// Or use the combined method:
// builder.Services.AddAllWhizbangServices();
```

## See Also

- [ServiceRegistrationOptions](service-registration-options) - Configuration options
- [ServiceRegistrationExtensions](service-registration) - Parent class
- [AddPerspectiveServices](perspective-services) - Register Perspective services
- [AddAllWhizbangServices](all-services) - Register all services
- [Lenses Guide](../core-concepts/lenses) - Understanding Lenses
