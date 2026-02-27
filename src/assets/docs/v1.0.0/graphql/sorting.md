# GraphQL Sorting

Whizbang's HotChocolate integration provides flexible sorting capabilities for `PerspectiveRow<T>` data.

## Basic Sorting

Sort results using the `order` argument:

```graphql
{
  orders(order: { data: { customerName: ASC } }) {
    nodes {
      data {
        customerName
        totalAmount
      }
    }
  }
}
```

## Sort Directions

- `ASC` - Ascending (A-Z, 0-9, oldest first)
- `DESC` - Descending (Z-A, 9-0, newest first)

```graphql
# Ascending
order: { data: { createdAt: ASC } }

# Descending
order: { data: { createdAt: DESC } }
```

## Sorting on Data Properties

Sort by any property in your read model:

```graphql
# By string
{
  products(order: { data: { name: ASC } }) {
    nodes { ... }
  }
}

# By number
{
  products(order: { data: { price: DESC } }) {
    nodes { ... }
  }
}

# By date
{
  orders(order: { data: { orderDate: DESC } }) {
    nodes { ... }
  }
}
```

## Multi-Column Sorting

Sort by multiple columns using an array:

```graphql
{
  orders(order: [
    { data: { status: ASC } }
    { data: { totalAmount: DESC } }
  ]) {
    nodes {
      data {
        status
        totalAmount
        customerName
      }
    }
  }
}
```

This sorts by status ascending first, then by total amount descending within each status.

## Sorting on System Fields

Sort by `PerspectiveRow` system fields:

```graphql
# By ID
{
  orders(order: { id: ASC }) {
    nodes { ... }
  }
}

# By version (for optimistic concurrency)
{
  orders(order: { version: DESC }) {
    nodes { ... }
  }
}

# By creation date
{
  orders(order: { createdAt: DESC }) {
    nodes { ... }
  }
}

# By last update
{
  orders(order: { updatedAt: DESC }) {
    nodes { ... }
  }
}
```

## Sorting on Metadata

When metadata is exposed:

```graphql
{
  orders(order: { metadata: { timestamp: DESC } }) {
    nodes {
      metadata {
        eventType
        timestamp
      }
    }
  }
}
```

## Combining Sort and Filter

Sort and filter work together:

```graphql
{
  orders(
    where: { data: { status: { eq: "Completed" } } }
    order: [
      { data: { totalAmount: DESC } }
      { createdAt: DESC }
    ]
  ) {
    nodes {
      data {
        customerName
        totalAmount
        status
      }
    }
  }
}
```

## Sorting with Paging

Always combine sorting with paging for consistent results:

```graphql
{
  orders(
    order: { createdAt: DESC }
    first: 10
    after: "cursor..."
  ) {
    nodes {
      data {
        customerName
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

## Sort with Variables

Use GraphQL variables for dynamic sorting:

```graphql
query GetProducts($sortField: ProductSortInput!) {
  products(order: [$sortField]) {
    nodes {
      data {
        name
        price
      }
    }
  }
}
```

## Default Sort Order

If no `order` is specified:
- With paging: Results are ordered by `id` for consistent pagination
- Without paging: Database default order (typically insertion order)

**Best Practice**: Always specify an explicit sort order for predictable results.

## Sort Precedence with Pre-Existing OrderBy

When application code applies a default `OrderBy` before HotChocolate's sorting middleware runs, use `[UseOrderByStripping]` to ensure GraphQL sorting takes precedence:

```csharp
[UsePaging]
[UseFiltering]
[UseSorting]
[UseOrderByStripping]  // Must be after UseSorting
public IQueryable<PerspectiveRow<Order>> GetOrders([Service] IOrderLens lens) {
  return lens.Query;  // May have pre-existing OrderBy from application code
}
```

### How It Works

The `[UseOrderByStripping]` attribute:

1. **Strips pre-existing ordering** when a GraphQL `order` argument is provided
2. **Preserves original ordering** when no GraphQL sorting is requested
3. **Ensures GraphQL sort is primary** - prevents HotChocolate from using `ThenBy` instead of `OrderBy`

### When to Use

Use `[UseOrderByStripping]` when:

- Your lens query applies a default `OrderBy` (e.g., `query.OrderBy(x => x.CreatedAt)`)
- You want GraphQL sorting to completely replace application-level ordering
- You're seeing `ThenByDescending` errors when sorting

### Example Scenario

Without `[UseOrderByStripping]`:
```csharp
// Application code
return _orders.Query.OrderBy(x => x.Id);  // Default order by ID

// GraphQL: order: { data: { name: DESC } }
// Result: OrderBy(Id).ThenByDescending(Name) ❌ Name is secondary
```

With `[UseOrderByStripping]`:
```csharp
// Application code with middleware
[UseOrderByStripping]
return _orders.Query.OrderBy(x => x.Id);

// GraphQL: order: { data: { name: DESC } }
// Result: OrderByDescending(Name) ✅ Name is primary
```

### Middleware Order

The `[UseOrderByStripping]` attribute must be placed AFTER `[UseSorting]` in the attribute stack:

```csharp
[UsePaging]       // Outermost
[UseProjection]
[UseFiltering]
[UseSorting]
[UseOrderByStripping]  // Innermost (closest to resolver) ✅
public IQueryable<T> GetData()
```

## Performance Considerations

1. **Index sort columns** - Ensure indexes exist for frequently sorted fields
2. **Limit multi-column sorts** - Each additional sort column may reduce index efficiency
3. **Sort + Filter alignment** - Best performance when sort and filter use the same indexed columns
4. **Consider composite indexes** - For common sort+filter combinations

## Example: Dashboard Query

A typical dashboard query combining filter, sort, and paging:

```graphql
query RecentOrders($tenantId: String!, $status: String) {
  orders(
    where: {
      and: [
        { scope: { tenantId: { eq: $tenantId } } }
        { data: { status: { eq: $status } } }
      ]
    }
    order: [
      { data: { priority: DESC } }
      { createdAt: DESC }
    ]
    first: 20
  ) {
    nodes {
      id
      data {
        customerName
        status
        priority
        totalAmount
      }
      createdAt
    }
    pageInfo {
      hasNextPage
      endCursor
    }
    totalCount
  }
}
```

## Next Steps

- [Scoping](scoping.md) - Multi-tenancy and security filtering
