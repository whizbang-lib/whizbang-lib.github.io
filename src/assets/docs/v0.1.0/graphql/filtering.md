# GraphQL Filtering

Whizbang's HotChocolate integration provides powerful filtering capabilities for `PerspectiveRow<T>` data using the standard HotChocolate filtering syntax.

## Basic Filtering

Filter on data properties using the `where` argument:

```graphql
{
  orders(where: { data: { status: { eq: "Completed" } } }) {
    nodes {
      data {
        customerName
        status
      }
    }
  }
}
```

## Filter Operators

### String Operators

```graphql
# Exact match
where: { data: { customerName: { eq: "Alice" } } }

# Not equal
where: { data: { customerName: { neq: "Bob" } } }

# Contains
where: { data: { customerName: { contains: "Corp" } } }

# Starts with
where: { data: { customerName: { startsWith: "Acme" } } }

# Ends with
where: { data: { customerName: { endsWith: "Inc" } } }

# In list
where: { data: { status: { in: ["Pending", "Processing"] } } }

# Not in list
where: { data: { status: { nin: ["Cancelled", "Refunded"] } } }
```

### Numeric Operators

```graphql
# Equal
where: { data: { totalAmount: { eq: 100.00 } } }

# Greater than
where: { data: { totalAmount: { gt: 50.00 } } }

# Greater than or equal
where: { data: { totalAmount: { gte: 100.00 } } }

# Less than
where: { data: { totalAmount: { lt: 1000.00 } } }

# Less than or equal
where: { data: { totalAmount: { lte: 500.00 } } }

# Range (between)
where: {
  and: [
    { data: { totalAmount: { gte: 100.00 } } }
    { data: { totalAmount: { lte: 500.00 } } }
  ]
}
```

### Date/Time Operators

```graphql
# Exact date
where: { data: { createdAt: { eq: "2024-01-15T00:00:00Z" } } }

# After date
where: { data: { createdAt: { gt: "2024-01-01T00:00:00Z" } } }

# Before date
where: { data: { createdAt: { lt: "2024-12-31T23:59:59Z" } } }

# Date range
where: {
  and: [
    { data: { createdAt: { gte: "2024-01-01T00:00:00Z" } } }
    { data: { createdAt: { lt: "2024-02-01T00:00:00Z" } } }
  ]
}
```

### Boolean Operators

```graphql
where: { data: { isActive: { eq: true } } }
where: { data: { isDeleted: { eq: false } } }
```

### Null Checks

```graphql
# Is null
where: { data: { deletedAt: { eq: null } } }

# Is not null
where: { data: { deletedAt: { neq: null } } }
```

## Logical Operators

### AND (Implicit)

Multiple conditions at the same level are AND'd together:

```graphql
{
  orders(where: {
    data: {
      status: { eq: "Completed" }
      totalAmount: { gte: 100.00 }
    }
  }) {
    nodes { ... }
  }
}
```

### AND (Explicit)

```graphql
{
  orders(where: {
    and: [
      { data: { status: { eq: "Completed" } } }
      { data: { totalAmount: { gte: 100.00 } } }
      { data: { customerName: { contains: "Corp" } } }
    ]
  }) {
    nodes { ... }
  }
}
```

### OR

```graphql
{
  orders(where: {
    or: [
      { data: { status: { eq: "Completed" } } }
      { data: { status: { eq: "Shipped" } } }
    ]
  }) {
    nodes { ... }
  }
}
```

### Complex Combinations

```graphql
{
  orders(where: {
    and: [
      { data: { totalAmount: { gte: 100.00 } } }
      {
        or: [
          { data: { status: { eq: "Completed" } } }
          { data: { status: { eq: "Shipped" } } }
        ]
      }
    ]
  }) {
    nodes { ... }
  }
}
```

## Filtering on System Fields

Filter on `PerspectiveRow` system fields:

```graphql
# By ID
{
  orders(where: { id: { eq: "550e8400-e29b-41d4-a716-446655440000" } }) {
    nodes { ... }
  }
}

# By version
{
  orders(where: { version: { gte: 2 } }) {
    nodes { ... }
  }
}

# By creation date
{
  orders(where: { createdAt: { gte: "2024-01-01T00:00:00Z" } }) {
    nodes { ... }
  }
}
```

## Filtering on Metadata

When metadata is exposed (scope includes `Metadata`):

```graphql
{
  orders(where: {
    metadata: {
      eventType: { eq: "OrderCreated" }
    }
  }) {
    nodes {
      metadata {
        eventType
        correlationId
      }
    }
  }
}
```

## Filtering on Scope

When scope is exposed (scope includes `Scope`):

```graphql
{
  adminOrders(where: {
    scope: {
      tenantId: { eq: "tenant-123" }
    }
  }) {
    nodes {
      scope {
        tenantId
        userId
      }
    }
  }
}
```

## Filtering with Variables

Use GraphQL variables for dynamic filtering:

```graphql
query GetOrders($status: String!, $minAmount: Decimal!) {
  orders(where: {
    and: [
      { data: { status: { eq: $status } } }
      { data: { totalAmount: { gte: $minAmount } } }
    ]
  }) {
    nodes {
      data {
        customerName
        status
        totalAmount
      }
    }
  }
}
```

Variables:
```json
{
  "status": "Completed",
  "minAmount": 100.00
}
```

## Performance Considerations

1. **Index your filter columns** - Ensure database indexes exist for commonly filtered fields
2. **Avoid wide OR clauses** - Multiple OR conditions can prevent index usage
3. **Use paging** - Always combine filtering with paging for large datasets
4. **Project only needed fields** - GraphQL projection optimizes the SQL query

## Next Steps

- [Sorting](sorting.md) - Sort operations
- [Scoping](scoping.md) - Automatic tenant filtering
