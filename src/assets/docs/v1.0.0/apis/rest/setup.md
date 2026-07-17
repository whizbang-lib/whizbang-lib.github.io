---
title: REST API Setup
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: REST
order: 1
description: >-
  Configure Whizbang REST endpoints with FastEndpoints - automatic endpoint
  generation for lenses and mutations
tags: 'rest, fastendpoints, api, setup, lens, mutations'
codeReferences:
  - src/Whizbang.Transports.FastEndpoints/Extensions/FastEndpointsWhizbangExtensions.cs
  - src/Whizbang.Transports.FastEndpoints/Endpoints/LensEndpointBase.cs
  - src/Whizbang.Transports.FastEndpoints/Endpoints/RestMutationEndpointBase.cs
  - src/Whizbang.Transports.FastEndpoints.Generators/RestLensEndpointGenerator.cs
  - src/Whizbang.Transports.FastEndpoints.Generators/RestMutationEndpointGenerator.cs
testReferences:
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/ServiceRegistrationTests.cs
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/LensEndpointBaseTests.cs
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/RestMutationEndpointBaseTests.cs
lastMaintainedCommit: '01f07906'
---

# REST API Setup

Whizbang integrates with [FastEndpoints](https://fast-endpoints.com/) to provide REST API endpoints for lenses and mutations with automatic source generation.

## Overview

The `Whizbang.Transports.FastEndpoints` package provides:

- **Automatic Endpoint Generation** - Source generators create REST endpoints from `[RestLens]` attributes
- **Filtering & Sorting** - Query parameter-based data operations
- **Paging Support** - Standard page/pageSize parameters
- **Hook Architecture** - Customize behavior via partial classes

## Installation

```bash{title="Installation" description="Installation" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Installation"]}
dotnet add package Whizbang.Transports.FastEndpoints
dotnet add package FastEndpoints
```

## Basic Configuration

### Minimal Setup

```csharp{title="Minimal Setup" description="Minimal Setup" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Minimal", "Setup"]}
// Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddFastEndpoints()
    .AddWhizbangLenses()
    .AddWhizbangMutations();

var app = builder.Build();

app.UseFastEndpoints();
app.Run();
```

### With Whizbang Core

```csharp{title="With Whizbang Core" description="With Whizbang Core" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Whizbang", "Core"]}
var builder = WebApplication.CreateBuilder(args);

// Add Whizbang core services
builder.Services.AddWhizbang();

// Add FastEndpoints with Whizbang integration
builder.Services.AddFastEndpoints()
    .AddWhizbangLenses()
    .AddWhizbangMutations();

var app = builder.Build();

app.UseFastEndpoints();
app.Run();
```

## Extension Methods

### AddWhizbangLenses

Registers lens endpoint services. Generated lens endpoints are auto-discovered by FastEndpoints.

```csharp{title="AddWhizbangLenses" description="Registers lens endpoint services." category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "AddWhizbangLenses"]}
builder.Services.AddFastEndpoints()
    .AddWhizbangLenses();
```

### AddWhizbangMutations

Registers mutation endpoint services. Generated mutation endpoints are auto-discovered by FastEndpoints.

```csharp{title="AddWhizbangMutations" description="Registers mutation endpoint services." category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "AddWhizbangMutations"]}
builder.Services.AddFastEndpoints()
    .AddWhizbangLenses()
    .AddWhizbangMutations();
```

## Defining REST Lenses

Use the `[RestLens]` attribute to mark lens interfaces for REST endpoint generation:

```csharp{title="Defining REST Lenses" description="Use the [RestLens] attribute to mark lens interfaces for REST endpoint generation:" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "C#", "Defining", "REST"]}
[RestLens(Route = "/api/orders")]
public interface IOrderLens : ILensQuery<OrderReadModel> { }
```

See [REST Filtering](filtering.md) for query parameter usage.

## Defining REST Mutations

Use the `[CommandEndpoint]` attribute **on the command class** to generate mutation endpoints:

```csharp{title="Defining REST Mutations" description="Use the [CommandEndpoint] attribute to generate mutation endpoints:" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "C#", "Defining", "REST"]}
[CommandEndpoint<CreateOrderCommand, OrderResult>(RestRoute = "/api/orders")]
public class CreateOrderCommand : ICommand {
    public required Guid CustomerId { get; init; }
}
```

See [REST Mutations](mutations.md) for details.

## Generated Endpoints

### Lens Endpoint

For a lens like:

```csharp{title="Lens Endpoint" description="For a lens like:" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Lens", "Endpoint"]}
[RestLens(Route = "/api/orders", DefaultPageSize = 25, MaxPageSize = 100)]
public interface IOrderLens : ILensQuery<OrderReadModel> { }
```

The generator creates (simplified):

```csharp{title="Lens Endpoint - OrderLensEndpoint" description="The generator creates:" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Rest", "Lens", "Endpoint"]}
public partial class OrderLensEndpoint : Endpoint<LensRequest, LensResponse<OrderReadModel>> {
    private readonly IOrderLens _lens;

    public OrderLensEndpoint(IOrderLens lens) {
        _lens = lens;
    }

    public override void Configure() {
        Get("/api/orders");
        AllowAnonymous();
    }

    public override async Task HandleAsync(LensRequest req, CancellationToken ct) {
        // Bounds-checked paging (DefaultPageSize = 25, MaxPageSize = 100)
        var page = Math.Max(1, req.Page);
        var pageSize = Math.Max(1, Math.Min(req.PageSize ?? 25, 100));
        var skip = (page - 1) * pageSize;

        // Default ordering by Id for consistent pagination
        var query = _lens.Query.Select(r => r.Data).OrderBy(x => x.Id);

        var totalCount = await query.CountAsync(ct);
        var items = await query.Skip(skip).Take(pageSize).ToListAsync(ct);

        await SendAsync(new LensResponse<OrderReadModel> {
            Data = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        }, cancellation: ct);
    }
}
```

### Mutation Endpoint

For a command like:

```csharp{title="Mutation Endpoint" description="For a command like:" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Mutation", "Endpoint"]}
[CommandEndpoint<CreateOrderCommand, OrderResult>(RestRoute = "/api/orders")]
public class CreateOrderCommand : ICommand {
    public required Guid CustomerId { get; init; }
}
```

The generator creates (simplified):

```csharp{title="Mutation Endpoint - CreateOrderCommandEndpoint" description="The generator creates:" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Rest", "Mutation", "Endpoint"]}
public partial class CreateOrderCommandEndpoint
    : RestMutationEndpointBase<CreateOrderCommand, OrderResult>,
      IEndpoint {
    private readonly IDispatcher _dispatcher;

    public CreateOrderCommandEndpoint(IDispatcher dispatcher) {
        _dispatcher = dispatcher;
    }

    public void Configure(IEndpointRouteBuilder routeBuilder) {
        routeBuilder.MapPost("/api/orders", HandleAsync);
    }

    protected override async ValueTask<OrderResult> DispatchCommandAsync(
        CreateOrderCommand command,
        CancellationToken ct) {
        return await _dispatcher.LocalInvokeAsync<CreateOrderCommand, OrderResult>(command, ct);
    }

    public async Task<OrderResult> HandleAsync(CreateOrderCommand command, CancellationToken ct) {
        return await ExecuteAsync(command, ct);
    }
}
```

All generated mutation endpoints are registered as **POST** routes. Mutation hooks (`OnBeforeExecuteAsync`, `OnAfterExecuteAsync`, `OnErrorAsync`) can be overridden in your own partial class - see [REST Mutations](mutations.md).

## Customizing Endpoints

Generated endpoints are partial classes, allowing you to add members in your own partial declaration (in the same `.Generated` namespace):

```csharp{title="Customizing Endpoints" description="Generated mutation endpoints expose overridable hooks:" category="API" difficulty="ADVANCED" tags=["Apis", "Rest", "Customizing", "Endpoints"]}
// Your partial class extension of a generated mutation endpoint
public partial class CreateOrderCommandEndpoint {
    protected override ValueTask OnBeforeExecuteAsync(
        CreateOrderCommand command,
        IMutationContext context,
        CancellationToken ct) {
        // Add validation, authorization, or logging before dispatch
        return ValueTask.CompletedTask;
    }
}
```

:::updated
Mutation endpoints inherit `RestMutationEndpointBase<TCommand, TResult>` and expose the `OnBeforeExecuteAsync`/`OnAfterExecuteAsync`/`OnErrorAsync` hooks. Generated *lens* endpoints currently inherit FastEndpoints' `Endpoint<LensRequest, LensResponse<TModel>>` directly, so the `LensEndpointBase<TModel>` query hooks (`OnBeforeQueryAsync`/`OnAfterQueryAsync`) are not available on generated lens endpoints yet.
:::

## What Gets Registered

`AddWhizbangLenses()` prepares the service collection for:
- Custom filter handlers (future)
- Custom sort handlers (future)
- Lens-specific middleware (future)

`AddWhizbangMutations()` prepares the service collection for:
- Custom validators (future)
- Authorization handlers (future)
- Mutation-specific middleware (future)

Note: Generated endpoints are auto-discovered by FastEndpoints' assembly scanning.

## Next Steps

- [REST Filtering](filtering.md) - Query parameter filtering
- [REST Mutations](mutations.md) - Command endpoint patterns
- [FastEndpoints Documentation](https://fast-endpoints.com/)
