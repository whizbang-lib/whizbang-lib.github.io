---
title: AddLensServices
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: DI
order: 4
description: >-
  Register all discovered Lens implementations with the DI container
tags: 'di, dependency-injection, lenses, service-registration, queries'
codeReferences:
  - src/Whizbang.Generators/Templates/ServiceRegistrationsTemplate.cs
  - src/Whizbang.Generators/ServiceRegistrationGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# AddLensServices

`AddLensServices` is a source-generated extension method that registers all discovered Lens implementations with the dependency injection container.

:::updated
`AddWhizbang()` invokes this method automatically via `ServiceRegistrationCallbacks` — an explicit call is only needed when registering services without `AddWhizbang()`, or with different options.
:::

## Signature

```csharp{title="Signature" description="Signature" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Configuration", "Signature"]}
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

```csharp{title="Register Lens Services" description="Register all discovered Lenses" category="DI" difficulty="BEGINNER" tags=["DI", "Lenses"] unverified="DI registration call — the generator output is verified by ServiceRegistrationGeneratorTests"}
var builder = WebApplication.CreateBuilder(args);

// Register all discovered Lens implementations
builder.Services.AddLensServices();
```

## With Options

```csharp{title="Register with Options" description="Customize Lens registration" category="DI" difficulty="BEGINNER" tags=["DI", "Lenses", "Options"] unverified="DI registration call — the generator output is verified by ServiceRegistrationGeneratorTests"}
// Disable self-registration
builder.Services.AddLensServices(options =>
    options.IncludeSelfRegistration = false);
```

## What Gets Registered

The source generator discovers classes that:
- Implement a user-defined interface extending `ILensQuery` (registered against the user interface), or implement `ILensQuery<TModel>` directly with a closed generic argument (registered against the Whizbang interface)
- Are not abstract

For each discovered Lens, it generates:

```csharp{title="Generated Registration" description="Example of generated Lens registration" category="DI" difficulty="INTERMEDIATE" tags=["DI", "SourceGenerator"] tests=["ServiceRegistrationGeneratorTests.Generator_SelfRegistration_EnabledByDefault_RegistersBothAsync"]}
// Interface registration
services.AddTransient<IOrderLens, OrderLens>();

// Self-registration (when IncludeSelfRegistration = true)
services.AddTransient<OrderLens>();
```

## Registration Lifetime

All Lenses are registered as **Transient** services:
- Fresh instance per resolution
- Scoped dependencies (like `DbContext`) come from the resolving scope
- No accidental state sharing between resolutions

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

  public async Task<IReadOnlyList<OrderSummary>> GetByCustomerAsync(
      CustomerId customerId,
      CancellationToken ct) =>
    await _db.OrderSummaries
       .Where(o => o.CustomerId == customerId)
       .OrderByDescending(o => o.CreatedAt)
       .ToListAsync(ct);

  public async Task<IReadOnlyList<OrderSummary>> GetRecentAsync(int count, CancellationToken ct) =>
    await _db.OrderSummaries
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

```csharp{title="Full Registration Setup" description="Complete DI setup with Lenses" category="DI" difficulty="INTERMEDIATE" tags=["DI", "Setup"] unverified="DI registration call — the generator output is verified by ServiceRegistrationGeneratorTests"}
var builder = WebApplication.CreateBuilder(args);

// Database
builder.Services.AddDbContext<AppDbContext>(...);

// Core Whizbang (auto-registers discovered Perspectives and Lenses)
builder.Services.AddWhizbang();

// Explicit generated registrations — only when bypassing AddWhizbang()
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
- [Lenses Guide](../../fundamentals/lenses/lenses) - Understanding Lenses
