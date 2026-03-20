---
title: REST Filtering
version: 1.0.0
category: REST
order: 2
description: >-
  Query parameter filtering, sorting, and paging for REST lens endpoints -
  standard URL patterns for data retrieval
tags: 'rest, filtering, sorting, paging, query-parameters, lensrequest'
codeReferences:
  - src/Whizbang.Transports.FastEndpoints/Models/LensRequest.cs
  - src/Whizbang.Transports.FastEndpoints/Endpoints/LensEndpointBase.cs
  - src/Whizbang.Transports.FastEndpoints/Attributes/RestLensAttribute.cs
testReferences:
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/LensRequestTests.cs
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/LensEndpointBaseTests.cs
---

# REST Filtering

Whizbang REST endpoints support filtering, sorting, and paging through standard query parameters using the `LensRequest` model.

## Overview

REST filtering provides:

- **Query Parameter Binding** - Standard URL patterns for filters
- **Sort Expressions** - Ascending/descending with multiple fields
- **Pagination** - Page-based navigation with configurable limits
- **Extensible Hooks** - Customize filtering behavior via partial classes

## LensRequest Model

The `LensRequest` class captures filtering, sorting, and paging parameters:

```csharp{title="LensRequest Model" description="The LensRequest class captures filtering, sorting, and paging parameters:" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "LensRequest", "Model"]}
public class LensRequest {
    public int Page { get; set; } = 1;
    public int? PageSize { get; set; }
    public string? Sort { get; set; }
    public Dictionary<string, string>? Filter { get; set; }
}
```

## Query Parameter Syntax

### Paging

```
GET /api/orders?page=2&pageSize=25
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | 1 | Current page number (1-based) |
| `pageSize` | Endpoint default | Items per page |

### Sorting

```
GET /api/orders?sort=-createdAt
GET /api/orders?sort=name
GET /api/orders?sort=-priority,createdAt
```

| Prefix | Direction |
|--------|-----------|
| `-` | Descending |
| `+` or none | Ascending |

Multiple fields are comma-separated and applied in order.

### Filtering

```
GET /api/orders?filter[status]=active
GET /api/orders?filter[status]=active&filter[priority]=high
GET /api/orders?filter[customerName]=Acme
```

Filters are key-value pairs using bracket notation.

## Complete URL Examples

### Basic Query

```
GET /api/orders
```

Returns first page with default page size.

### Filtered and Sorted

```
GET /api/orders?filter[status]=completed&sort=-createdAt&page=1&pageSize=10
```

Returns completed orders, newest first, 10 per page.

### Multiple Filters

```
GET /api/orders?filter[status]=pending&filter[priority]=high&filter[region]=west
```

All filters are AND'd together.

## Defining REST Lenses

### Basic Lens

```csharp{title="Basic Lens" description="Demonstrates basic Lens" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Basic", "Lens"]}
[RestLens(Route = "/api/orders")]
public interface IOrderLens : ILensQuery<OrderReadModel> { }
```

### With Custom Paging

```csharp{title="With Custom Paging" description="Demonstrates with Custom Paging" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Custom", "Paging"]}
[RestLens(
    Route = "/api/orders",
    DefaultPageSize = 25,
    MaxPageSize = 100)]
public interface IOrderLens : ILensQuery<OrderReadModel> { }
```

### Filtering Only (No Sorting)

```csharp{title="Filtering Only (No Sorting)" description="Demonstrates filtering Only (No Sorting)" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Filtering", "Only"]}
[RestLens(
    Route = "/api/statuses",
    EnableSorting = false,
    EnablePaging = false)]
public interface IStatusLens : ILensQuery<StatusReadModel> { }
```

## RestLensAttribute Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Route` | `string?` | Model-based | REST route pattern |
| `EnableFiltering` | `bool` | `true` | Accept filter parameters |
| `EnableSorting` | `bool` | `true` | Accept sort parameters |
| `EnablePaging` | `bool` | `true` | Accept page/pageSize |
| `DefaultPageSize` | `int` | `10` | Default items per page |
| `MaxPageSize` | `int` | `100` | Maximum allowed page size |

## Response Format

### LensResponse

```csharp{title="LensResponse" description="Demonstrates lensResponse" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Rest", "LensResponse"]}
public class LensResponse<T> {
    public IReadOnlyList<T> Data { get; init; }
    public int Page { get; init; }
    public int PageSize { get; init; }
    public int TotalCount { get; init; }
    public int TotalPages { get; init; }
    public bool HasNextPage { get; init; }
    public bool HasPreviousPage { get; init; }
}
```

### Example Response

```json{title="Example Response" description="Demonstrates example Response" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Rest", "Example", "Response"]}
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "customerName": "Acme Corp",
      "status": "Completed",
      "totalAmount": 150.00,
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "page": 1,
  "pageSize": 10,
  "totalCount": 42,
  "totalPages": 5,
  "hasNextPage": true,
  "hasPreviousPage": false
}
```

## Sort Expression Parsing

The `LensEndpointBase` provides a helper for parsing sort strings:

```csharp{title="Sort Expression Parsing" description="The LensEndpointBase provides a helper for parsing sort strings:" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Sort", "Expression"]}
protected IReadOnlyList<SortExpression> ParseSortExpression(string? sort);

public readonly record struct SortExpression(string Field, bool Descending);
```

### Example

```csharp{title="Example" description="Demonstrates example" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Example"]}
var sorts = ParseSortExpression("-createdAt,name,+status");
// Returns:
// [
//   { Field: "createdAt", Descending: true },
//   { Field: "name", Descending: false },
//   { Field: "status", Descending: false }
// ]
```

## Paging Calculation

The base class provides bounds-checked paging:

```csharp{title="Paging Calculation" description="The base class provides bounds-checked paging:" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Paging", "Calculation"]}
protected (int skip, int take) CalculatePaging(
    LensRequest request,
    int defaultPageSize,
    int maxPageSize);
```

### Example

```csharp{title="Example (2)" description="Demonstrates example" category="API" difficulty="BEGINNER" tags=["Apis", "Rest", "Example"]}
// With request: page=3, pageSize=50, max=100
var (skip, take) = CalculatePaging(request, 10, 100);
// skip = 100 (page 3, 0-indexed: 2 * 50)
// take = 50
```

## Customizing Filter Behavior

Extend the generated endpoint to add custom filtering:

```csharp{title="Customizing Filter Behavior" description="Extend the generated endpoint to add custom filtering:" category="API" difficulty="ADVANCED" tags=["Apis", "Rest", "Customizing", "Filter"]}
public partial class OrderLensEndpoint {
    protected override async ValueTask OnBeforeQueryAsync(LensRequest request, CancellationToken ct) {
        // Add default filters
        request.Filter ??= new Dictionary<string, string>();

        // Only show active orders by default
        if (!request.Filter.ContainsKey("isDeleted")) {
            request.Filter["isDeleted"] = "false";
        }

        // Log the query
        _logger.LogInformation("Querying orders: {@Request}", request);
    }
}
```

## Client Examples

### JavaScript/TypeScript

```typescript{title="JavaScript/TypeScript" description="Demonstrates javaScript/TypeScript" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Rest", "JavaScript", "TypeScript"]}
async function getOrders(params: {
    page?: number;
    pageSize?: number;
    sort?: string;
    filters?: Record<string, string>;
}) {
    const url = new URL('/api/orders', baseUrl);

    if (params.page) url.searchParams.set('page', params.page.toString());
    if (params.pageSize) url.searchParams.set('pageSize', params.pageSize.toString());
    if (params.sort) url.searchParams.set('sort', params.sort);

    if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
            url.searchParams.set(`filter[${key}]`, value);
        }
    }

    const response = await fetch(url.toString());
    return response.json();
}

// Usage
const orders = await getOrders({
    page: 1,
    pageSize: 25,
    sort: '-createdAt',
    filters: { status: 'pending' }
});
```

### C# HttpClient

```csharp{title="C# HttpClient" description="Demonstrates c# HttpClient" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Rest", "HttpClient"]}
public async Task<LensResponse<OrderReadModel>> GetOrdersAsync(
    int page = 1,
    int pageSize = 10,
    string? sort = null,
    Dictionary<string, string>? filters = null) {
    var query = new List<string> {
        $"page={page}",
        $"pageSize={pageSize}"
    };

    if (!string.IsNullOrEmpty(sort)) {
        query.Add($"sort={Uri.EscapeDataString(sort)}");
    }

    if (filters != null) {
        foreach (var (key, value) in filters) {
            query.Add($"filter[{key}]={Uri.EscapeDataString(value)}");
        }
    }

    var url = $"/api/orders?{string.Join("&", query)}";
    return await _httpClient.GetFromJsonAsync<LensResponse<OrderReadModel>>(url);
}
```

## Related Documentation

- [REST Setup](setup.md) - Installation and configuration
- [REST Mutations](mutations.md) - Command endpoints
- [GraphQL Filtering](../graphql/filtering.md) - Comparison with GraphQL approach
