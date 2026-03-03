---
title: REST API Setup
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
testReferences:
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/ServiceRegistrationTests.cs
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

```bash
dotnet add package Whizbang.Transports.FastEndpoints
dotnet add package FastEndpoints
```

## Basic Configuration

### Minimal Setup

```csharp
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

```csharp
var builder = WebApplication.CreateBuilder(args);

// Add Whizbang core services
builder.Services.AddWhizbang();

// Add FastEndpoints with Whizbang integration
builder.Services.AddFastEndpoints()
    .AddWhizbangLenses()
    .AddWhizbangMutations();

var app = builder.Build();

app.UseWhizbangScope();  // For multi-tenancy
app.UseFastEndpoints();
app.Run();
```

## Extension Methods

### AddWhizbangLenses

Registers lens endpoint services. Generated lens endpoints are auto-discovered by FastEndpoints.

```csharp
builder.Services.AddFastEndpoints()
    .AddWhizbangLenses();
```

### AddWhizbangMutations

Registers mutation endpoint services. Generated mutation endpoints are auto-discovered by FastEndpoints.

```csharp
builder.Services.AddFastEndpoints()
    .AddWhizbangLenses()
    .AddWhizbangMutations();
```

## Defining REST Lenses

Use the `[RestLens]` attribute to mark lens interfaces for REST endpoint generation:

```csharp
[RestLens(Route = "/api/orders")]
public interface IOrderLens : ILensQuery<OrderReadModel> { }
```

See [REST Filtering](filtering.md) for query parameter usage.

## Defining REST Mutations

Use the `[CommandEndpoint]` attribute to generate mutation endpoints:

```csharp
[CommandEndpoint<CreateOrderCommand, OrderResult>(RestRoute = "/api/orders")]
public partial class CreateOrderEndpoint;
```

See [REST Mutations](mutations.md) for details.

## Generated Endpoints

### Lens Endpoint

For a lens like:

```csharp
[RestLens(Route = "/api/orders", DefaultPageSize = 25, MaxPageSize = 100)]
public interface IOrderLens : ILensQuery<OrderReadModel> { }
```

The generator creates:

```csharp
public partial class OrderLensEndpoint : LensEndpointBase<OrderReadModel> {
    public override void Configure() {
        Get("/api/orders");
        AllowAnonymous(); // Configure as needed
    }

    public override async Task HandleAsync(LensRequest req, CancellationToken ct) {
        await OnBeforeQueryAsync(req, ct);
        // Execute query with filtering, sorting, paging
        var response = await ExecuteQueryAsync(req, ct);
        await OnAfterQueryAsync(req, response, ct);
        await SendAsync(response, cancellation: ct);
    }
}
```

### Mutation Endpoint

For a command like:

```csharp
[CommandEndpoint<CreateOrderCommand, OrderResult>(RestRoute = "/api/orders")]
public partial class CreateOrderEndpoint;
```

The generator creates:

```csharp
public partial class CreateOrderEndpoint : RestMutationEndpointBase<CreateOrderCommand, OrderResult> {
    public override void Configure() {
        Post("/api/orders");
    }

    public override async Task HandleAsync(CreateOrderCommand cmd, CancellationToken ct) {
        var result = await ExecuteAsync(cmd, ct);
        await SendAsync(result, cancellation: ct);
    }
}
```

## Customizing Endpoints

Generated endpoints are partial classes, allowing customization:

```csharp
// Your partial class extension
public partial class OrderLensEndpoint {
    protected override async ValueTask OnBeforeQueryAsync(LensRequest request, CancellationToken ct) {
        // Add custom validation
        if (request.PageSize > 50) {
            AddError("PageSize cannot exceed 50 for this endpoint");
            await SendErrorsAsync(cancellation: ct);
            return;
        }

        // Add logging
        _logger.LogInformation("Querying orders with filters: {Filters}", request.Filter);
    }
}
```

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
