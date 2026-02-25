# Lens Integration

The `[GraphQLLens]` attribute marks lens interfaces for GraphQL exposure, enabling automatic query generation with configurable filtering, sorting, and paging.

## Basic Usage

```csharp
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

## GraphQLLensScope

Control which parts of `PerspectiveRow<T>` are exposed:

```csharp
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

```csharp
[GraphQLLens(QueryName = "products", Scope = GraphQLLensScope.DataOnly)]
public interface IProductLens : ILensQuery<ProductReadModel> { }
```

```graphql
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

```csharp
[GraphQLLens(
    QueryName = "auditLog",
    Scope = GraphQLLensScope.Data | GraphQLLensScope.Metadata | GraphQLLensScope.SystemFields)]
public interface IAuditLens : ILensQuery<AuditReadModel> { }
```

```graphql
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

```csharp
[GraphQLLens(QueryName = "adminOrders", Scope = GraphQLLensScope.All)]
public interface IAdminOrderLens : ILensQuery<OrderReadModel> { }
```

```graphql
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

```csharp
[GraphQLLens(
    QueryName = "statuses",
    EnablePaging = false,
    EnableSorting = false)]
public interface IStatusLens : ILensQuery<StatusReadModel> { }
```

```graphql
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

```csharp
[GraphQLLens(
    QueryName = "transactions",
    DefaultPageSize = 50,
    MaxPageSize = 500)]
public interface ITransactionLens : ILensQuery<TransactionReadModel> { }
```

## Generated Schema

For a lens like:

```csharp
[GraphQLLens(QueryName = "orders")]
public interface IOrderLens : ILensQuery<OrderReadModel> { }

public record OrderReadModel {
    public string CustomerName { get; init; }
    public string Status { get; init; }
    public decimal TotalAmount { get; init; }
}
```

The generated GraphQL schema includes:

```graphql
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

```csharp
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
