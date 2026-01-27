---
title: "MustExist Attribute"
description: "Marks a perspective Apply method as requiring the model to already exist"
category: "Attributes"
tags: ["attributes", "mustexist", "perspectives", "validation", "source-generator"]
---

# MustExist Attribute

The `[MustExist]` attribute marks a perspective Apply method as requiring the model to already exist. When applied, the generated runner code includes a null check before calling the Apply method, throwing an `InvalidOperationException` if the current model is null.

## Namespace

```csharp
using Whizbang.Core.Perspectives;
```

## Syntax

```csharp
[MustExist]
public TModel Apply(TModel current, TEvent @event) { ... }
```

## Applies To

- **Apply methods** on perspective classes (types implementing `IPerspectiveFor<TModel, TEvent>`)

## Purpose

The `[MustExist]` attribute serves two purposes:

1. **Explicit Intent**: Clearly signals that an Apply method handles "update" events where the model must have been created by a prior event
2. **Runtime Validation**: The source generator produces a null check that throws a descriptive error before the Apply method is called

## Generated Behavior

When the generator encounters a method with `[MustExist]`, it produces:

```csharp
case OrderShippedEvent typedEvent:
  if (currentModel == null)
    throw new InvalidOperationException(
      "OrderModel must exist when applying OrderShippedEvent in OrderPerspective");
  return perspective.Apply(currentModel, typedEvent);
```

## Basic Example

```csharp
public class OrderPerspective :
    IPerspectiveFor<OrderView, OrderCreated>,
    IPerspectiveFor<OrderView, OrderShipped> {

  // Creation event - nullable parameter, handles initial creation
  public OrderView Apply(OrderView? current, OrderCreated @event) {
    return new OrderView {
      OrderId = @event.OrderId,
      CustomerId = @event.CustomerId,
      Status = "Created"
    };
  }

  // Update event - non-nullable parameter, requires existing model
  [MustExist]
  public OrderView Apply(OrderView current, OrderShipped @event) {
    return current with {
      Status = "Shipped",
      ShippedAt = @event.ShippedAt
    };
  }
}
```

## Parameter Nullability

Use the nullable annotation to signal intent alongside `[MustExist]`:

| Scenario | Parameter Type | Attribute |
|----------|---------------|-----------|
| Creation event (may create new model) | `TModel?` | None |
| Update event (requires existing model) | `TModel` | `[MustExist]` |

### Non-Nullable Parameter (Recommended with [MustExist])

When using `[MustExist]`, the parameter should be non-nullable to match the semantic meaning:

```csharp
// Correct: Non-nullable parameter signals "model must exist"
[MustExist]
public OrderView Apply(OrderView current, OrderShipped @event) {
  return current with { Status = "Shipped" };
}
```

### Nullable Parameter (Without [MustExist])

Without `[MustExist]`, the parameter should be nullable since the model may not exist yet:

```csharp
// Correct: Nullable parameter signals "model may or may not exist"
public OrderView Apply(OrderView? current, OrderCreated @event) {
  return new OrderView { OrderId = @event.OrderId };
}
```

## Multiple Events Example

Apply `[MustExist]` to each update event that requires an existing model:

```csharp
public class AccountPerspective :
    IPerspectiveFor<AccountView, AccountOpened>,
    IPerspectiveFor<AccountView, FundsDeposited>,
    IPerspectiveFor<AccountView, FundsWithdrawn>,
    IPerspectiveFor<AccountView, AccountClosed> {

  // Creation - no attribute, nullable parameter
  public AccountView Apply(AccountView? current, AccountOpened @event) {
    return new AccountView {
      AccountId = @event.AccountId,
      Balance = @event.InitialDeposit,
      Status = "Active"
    };
  }

  // Update - [MustExist], non-nullable parameter
  [MustExist]
  public AccountView Apply(AccountView current, FundsDeposited @event) {
    return current with { Balance = current.Balance + @event.Amount };
  }

  // Update - [MustExist], non-nullable parameter
  [MustExist]
  public AccountView Apply(AccountView current, FundsWithdrawn @event) {
    return current with { Balance = current.Balance - @event.Amount };
  }

  // Update - [MustExist], non-nullable parameter
  [MustExist]
  public AccountView Apply(AccountView current, AccountClosed @event) {
    return current with { Status = "Closed", ClosedAt = @event.ClosedAt };
  }
}
```

## Error Message Format

The generated error message includes:
- **Model type name**: The type being updated
- **Event type name**: The event that triggered the error
- **Perspective name**: The perspective class where the error occurred

Example error:
```
InvalidOperationException: AccountView must exist when applying FundsWithdrawn in AccountPerspective
```

This detailed message helps developers quickly identify where the issue occurred.

## When to Use [MustExist]

### Use When

- The event is an "update" that modifies existing state
- The event cannot logically occur without a prior creation event
- You want fail-fast behavior instead of silent null handling

### Examples Where [MustExist] Is Appropriate

```csharp
// OrderShipped requires an order to already exist
[MustExist]
public OrderView Apply(OrderView current, OrderShipped @event) { ... }

// FundsWithdrawn requires an account to already exist
[MustExist]
public AccountView Apply(AccountView current, FundsWithdrawn @event) { ... }

// UserProfileUpdated requires a user profile to already exist
[MustExist]
public UserProfileView Apply(UserProfileView current, UserProfileUpdated @event) { ... }
```

### Do NOT Use When

- The event is a creation event
- The event might be the first event for a stream
- You want to handle null explicitly in the method body

## Comparison: With vs Without [MustExist]

### Without [MustExist] (Manual Null Check)

```csharp
public OrderView Apply(OrderView? current, OrderShipped @event) {
  if (current is null)
    throw new InvalidOperationException("Order must exist");

  return current with { Status = "Shipped" };
}
```

### With [MustExist] (Generated Null Check)

```csharp
[MustExist]
public OrderView Apply(OrderView current, OrderShipped @event) {
  return current with { Status = "Shipped" };
}
```

Benefits of using `[MustExist]`:
- Cleaner Apply method focuses on the transformation logic
- Non-nullable parameter enforced by the generator
- Consistent, descriptive error message format
- No boilerplate null checks in business logic

## Zero Reflection and AOT

The `[MustExist]` attribute is processed at compile time by the source generator:

```csharp
// Generated code - no runtime reflection
case OrderShippedEvent typedEvent:
  if (currentModel == null)
    throw new InvalidOperationException(
      "OrderView must exist when applying OrderShippedEvent in OrderPerspective");
  return perspective.Apply(currentModel, typedEvent);
```

This generated code:
- Works with Native AOT
- Has zero runtime overhead
- Is type-safe at compile-time

## Migration from Marten

When migrating from Marten projections, the Whizbang migration tool will:
1. Identify Apply methods with non-nullable first parameters
2. Suggest adding `[MustExist]` attribute

See [Automated Migration](../migration-guide/automated-migration.md) for details.

## See Also

- [Perspectives](../core-concepts/perspectives.md) - Understanding perspectives and Apply methods
- [StreamKey Attribute](./streamkey.md) - Identifying stream keys for event ordering
- [Automated Migration](../migration-guide/automated-migration.md) - Migrating from Marten/Wolverine
