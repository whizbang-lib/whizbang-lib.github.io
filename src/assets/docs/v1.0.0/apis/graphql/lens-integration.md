---
title: Lens Integration
version: 1.0.0
category: GraphQL
order: 3
description: >-
  The GraphQLLens attribute for marking lens interfaces for GraphQL exposure
  with automatic query generation. Covers attribute properties, GraphQLLensScope
  options, and configurable filtering, sorting, and paging.
tags: 'graphql, lens, graphql-lens-attribute, scope, query-generation, hotchocolate'
codeReferences:
  - src/Whizbang.Transports.HotChocolate/Attributes/GraphQLLensAttribute.cs
  - src/Whizbang.Transports.HotChocolate/Attributes/GraphQLLensScope.cs
lastMaintainedCommit: '01f07906'
---

# Lens Integration

The `[GraphQLLens]` attribute marks lens interfaces for GraphQL exposure, enabling automatic query generation with configurable filtering, sorting, and paging.

## Basic Usage

```csharp{title="Basic Usage" description="Basic Usage" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Basic", "Usage"]}
[GraphQLLens(QueryName = "orders")]
public interface IOrderLens : ILensQuery<OrderReadModel> { }
```

This generates a GraphQL query field named `orders` with full data operations support.

## Attribute Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `QueryName` | `string` | Interface name | GraphQL field name |
| `Scope` | `GraphQLLensScope` | `Default` | Which fields to expose |
| `EnableFiltering` | `bool` | `true` | Enable `where` argument |
| `EnableSorting` | `bool` | `true` | Enable `order` argument |
| `EnablePaging` | `bool` | `true` | Enable Relay-style paging |
| `EnableProjection` | `bool` | `true` | Enable field selection optimization |
| `DefaultPageSize` | `int` | `10` | Default items per page |
| `MaxPageSize` | `int` | `100` | Maximum items per page |

## GraphQLLensScope {#scope}

Control which parts of `PerspectiveRow<T>` are exposed through the GraphQL schema. The scope determines which nested fields are available for querying.

### The `data` Parameter

When you query a lens-backed GraphQL field, the results are wrapped in `PerspectiveRow<TModel>`, which contains:

- **`data`** - The business model (your perspective's projection)
- **`metadata`** - Event sourcing metadata (eventType, correlationId, timestamp)
- **`scope`** - Security/tenancy context (tenantId, userId, organizationId)
- **`systemFields`** - Infrastructure fields (id, version, createdAt, updatedAt)

The `data` field contains your actual business model that the perspective projects. For example, if your perspective projects to `ProductReadModel`, the `data` field will expose `ProductReadModel`'s properties.

### Scope Control

Control which parts of `PerspectiveRow<T>` are exposed:

```csharp{title="Scope Control" description="Control which parts of PerspectiveRow<T> are exposed:" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Graphql", "Scope", "Control"]}
[Flags]
public enum GraphQLLensScope {
    Default = 0,           // Use system default
    Data = 1 << 0,         // TModel properties
    Metadata = 1 << 1,     // EventType, CorrelationId, Timestamp
    Scope = 1 << 2,        // TenantId, UserId, OrganizationId
    SystemFields = 1 << 3, // Id, Version, CreatedAt, UpdatedAt

    // Presets
    DataOnly = Data,
    NoData = Metadata | Scope | SystemFields,
    All = Data | Metadata | Scope | SystemFields
}
```

## Configuration Examples

### Data Only (Default)

Expose only the business data:

```csharp{title="Data Only (Default)" description="Expose only the business data:" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Data", "Only"]}
[GraphQLLens(QueryName = "products", Scope = GraphQLLensScope.DataOnly)]
public interface IProductLens : ILensQuery<ProductReadModel> { }
```

```graphql{title="" description="" category="Apis" difficulty="BEGINNER" tags=["Apis", "Graphql", "GRAPHQL"]}
{
  products {
    nodes {
      data {
        name
        price
        category
      }
    }
  }
}
```

### With Metadata

Include event sourcing metadata:

```csharp{title="With Metadata" description="Include event sourcing metadata:" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Metadata"]}
[GraphQLLens(
    QueryName = "auditLog",
    Scope = GraphQLLensScope.Data | GraphQLLensScope.Metadata | GraphQLLensScope.SystemFields)]
public interface IAuditLens : ILensQuery<AuditReadModel> { }
```

```graphql{title="" description="" category="Apis" difficulty="BEGINNER" tags=["Apis", "Graphql", "GRAPHQL"]}
{
  auditLog {
    nodes {
      id
      version
      data {
        action
        description
      }
      metadata {
        eventType
        correlationId
        timestamp
      }
    }
  }
}
```

### Full Row (Admin View)

Expose everything including scope data:

```csharp{title="Full Row (Admin View)" description="Expose everything including scope data:" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Full", "Row"]}
[GraphQLLens(QueryName = "adminOrders", Scope = GraphQLLensScope.All)]
public interface IAdminOrderLens : ILensQuery<OrderReadModel> { }
```

```graphql{title="" description="" category="Apis" difficulty="BEGINNER" tags=["Apis", "Graphql", "GRAPHQL"]}
{
  adminOrders {
    nodes {
      id
      version
      createdAt
      updatedAt
      data {
        customerName
        status
      }
      metadata {
        eventType
        correlationId
      }
      scope {
        tenantId
        userId
      }
    }
  }
}
```

### Filter-Only (No Paging)

Disable paging for simple lists:

```csharp{title="Filter-Only (No Paging)" description="Disable paging for simple lists:" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Filter-Only", "Paging"]}
[GraphQLLens(
    QueryName = "statuses",
    EnablePaging = false,
    EnableSorting = false)]
public interface IStatusLens : ILensQuery<StatusReadModel> { }
```

```graphql{title="" description="" category="Apis" difficulty="BEGINNER" tags=["Apis", "Graphql", "GRAPHQL"]}
{
  statuses(where: { data: { isActive: { eq: true } } }) {
    id
    data {
      name
      isActive
    }
  }
}
```

### Custom Page Sizes

Configure paging limits:

```csharp{title="Custom Page Sizes" description="Configure paging limits:" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Custom", "Page"]}
[GraphQLLens(
    QueryName = "transactions",
    DefaultPageSize = 50,
    MaxPageSize = 500)]
public interface ITransactionLens : ILensQuery<TransactionReadModel> { }
```

## Generated Schema

For a lens like:

```csharp{title="Generated Schema" description="For a lens like:" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Generated", "Schema"]}
[GraphQLLens(QueryName = "orders")]
public interface IOrderLens : ILensQuery<OrderReadModel> { }

public record OrderReadModel {
    public string CustomerName { get; init; }
    public string Status { get; init; }
    public decimal TotalAmount { get; init; }
}
```

The generated GraphQL schema includes:

```graphql{title="type Query" description="type Query" category="Apis" difficulty="BEGINNER" tags=["Apis", "Graphql", "GRAPHQL"]}
type Query {
  orders(
    where: OrderFilterInput
    order: [OrderSortInput!]
    first: Int
    after: String
    last: Int
    before: String
  ): OrdersConnection
}

type OrdersConnection {
  nodes: [Order!]
  edges: [OrderEdge!]
  pageInfo: PageInfo!
  totalCount: Int!
}

type Order {
  id: UUID!
  version: Int!
  data: OrderData!
  metadata: PerspectiveMetadata
  scope: PerspectiveScope
  createdAt: DateTime!
  updatedAt: DateTime!
}

type OrderData {
  customerName: String!
  status: String!
  totalAmount: Decimal!
}

input OrderFilterInput {
  and: [OrderFilterInput!]
  or: [OrderFilterInput!]
  data: OrderDataFilterInput
  id: UuidOperationFilterInput
  version: IntOperationFilterInput
}
```

## Multiple Lenses for Same Model

You can create multiple lenses for the same model with different configurations:

```csharp{title="Multiple Lenses for Same Model" description="You can create multiple lenses for the same model with different configurations:" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Graphql", "Multiple", "Lenses"]}
// Public API - data only
[GraphQLLens(QueryName = "orders", Scope = GraphQLLensScope.DataOnly)]
public interface IOrderLens : ILensQuery<OrderReadModel> { }

// Admin API - full access
[GraphQLLens(QueryName = "adminOrders", Scope = GraphQLLensScope.All)]
public interface IAdminOrderLens : ILensQuery<OrderReadModel> { }

// Audit API - metadata focus
[GraphQLLens(
    QueryName = "orderAudit",
    Scope = GraphQLLensScope.Metadata | GraphQLLensScope.SystemFields,
    EnableFiltering = false)]
public interface IOrderAuditLens : ILensQuery<OrderReadModel> { }
```

## Next Steps

- [Filtering](filtering.md) - Query filtering syntax
- [Sorting](sorting.md) - Sort operations
- [Scoping](scoping.md) - Multi-tenancy filtering
