---
title: "MustExist Attribute"
pageType: reference
description: "Marks a perspective Apply method as requiring the model to already exist"
category: "Attributes"
tags: ["attributes", "mustexist", "perspectives", "validation", "source-generator"]
order: 6
version: 1.0.0
codeReferences:
  - src/Whizbang.Core/Perspectives/MustExistAttribute.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/MustExistAttributeTests.cs
---

# MustExist Attribute

The `[MustExist]` attribute marks a perspective Apply method as requiring the model to already exist. When applied, the generated runner code includes a null check before calling the Apply method, throwing an `InvalidOperationException` if the current model is null.

## Namespace

```csharp{
title: "Import the perspectives namespace"
description: "[MustExist] lives in Whizbang.Core.Perspectives alongside the perspective interfaces."
framework: "NET10"
category: "Attributes"
difficulty: "BEGINNER"
tags: ["must-exist", "namespace", "perspectives"]
unverified: "namespace import, not a behaviour"
}
using Whizbang.Core.Perspectives;
```

## Syntax

```csharp{
title: "Where [MustExist] is applied"
description: "The attribute goes on an Apply method, which is the only target it allows."
framework: "NET10"
category: "Attributes"
difficulty: "BEGINNER"
tags: ["must-exist", "syntax", "apply", "perspectives"]
tests: ["MustExistAttributeTests.MustExistAttribute_TargetsMethodsOnlyAsync"]
}
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

```csharp{
title: "The null check the generator emits"
description: "Generated dispatch code throws when the model is absent, so the Apply method never sees a null current model."
framework: "NET10"
category: "Attributes"
difficulty: "ADVANCED"
tags: ["must-exist", "source-generator", "generated-code", "null-check"]
unverified: "generated code - shown to explain the emitted check"
}
case OrderShippedEvent typedEvent:
  if (currentModel == null)
    throw new InvalidOperationException(
      "OrderModel must exist when applying OrderShippedEvent in OrderPerspective");
  return perspective.Apply(currentModel, typedEvent);
```

## Basic Example

```csharp{
title: "A perspective that creates then requires its model"
description: "OrderCreated builds the view with a nullable parameter; OrderShipped declares [MustExist] and takes it non-nullable."
framework: "NET10"
category: "Attributes"
difficulty: "INTERMEDIATE"
tags: ["must-exist", "perspectives", "apply", "order-lifecycle"]
}
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

```csharp{
title: "Non-nullable parameter with [MustExist]"
description: "The recommended pairing: the attribute guarantees the model exists, so the parameter can be declared non-nullable."
framework: "NET10"
category: "Attributes"
difficulty: "BEGINNER"
tags: ["must-exist", "nullability", "apply", "conventions"]
}
// Correct: Non-nullable parameter signals "model must exist"
[MustExist]
public OrderView Apply(OrderView current, OrderShipped @event) {
  return current with { Status = "Shipped" };
}
```

### Nullable Parameter (Without [MustExist])

Without `[MustExist]`, the parameter should be nullable since the model may not exist yet:

```csharp{
title: "Nullable parameter without [MustExist]"
description: "An Apply method that may legitimately run with no model yet keeps the nullable parameter and no attribute."
framework: "NET10"
category: "Attributes"
difficulty: "BEGINNER"
tags: ["must-exist", "nullability", "apply", "conventions"]
}
// Correct: Nullable parameter signals "model may or may not exist"
public OrderView Apply(OrderView? current, OrderCreated @event) {
  return new OrderView { OrderId = @event.OrderId };
}
```

## Multiple Events Example

Apply `[MustExist]` to each update event that requires an existing model:

```csharp{
title: "Mixed lifecycle across several events"
description: "One perspective where the opening event creates the model and the later events require it."
framework: "NET10"
category: "Attributes"
difficulty: "INTERMEDIATE"
tags: ["must-exist", "perspectives", "multi-event", "account-lifecycle"]
}
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

```csharp{
title: "Events that cannot be first"
description: "Shipping, cancelling and similar events presuppose the model, which is exactly where the attribute belongs."
framework: "NET10"
category: "Attributes"
difficulty: "BEGINNER"
tags: ["must-exist", "guidance", "apply", "perspectives"]
}
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

```csharp{
title: "The manual null check [MustExist] replaces"
description: "The same guarantee written by hand in every Apply method, which is what the attribute removes."
framework: "NET10"
category: "Attributes"
difficulty: "BEGINNER"
tags: ["must-exist", "boilerplate", "null-check", "contrast"]
unverified: "contrast case - the manual check the attribute replaces"
}
public OrderView Apply(OrderView? current, OrderShipped @event) {
  if (current is null)
    throw new InvalidOperationException("Order must exist");

  return current with { Status = "Shipped" };
}
```

### With [MustExist] (Generated Null Check)

```csharp{
title: "The same method with [MustExist]"
description: "The attribute carries the precondition, so the body is only the state transition."
framework: "NET10"
category: "Attributes"
difficulty: "BEGINNER"
tags: ["must-exist", "apply", "state-transition", "perspectives"]
}
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

```csharp{
title: "Generated dispatch uses no reflection"
description: "The emitted check is a plain type switch and null test, so the attribute costs nothing at run time and stays AOT-safe."
framework: "NET10"
category: "Attributes"
difficulty: "ADVANCED"
tags: ["must-exist", "aot", "source-generator", "performance"]
unverified: "generated code - illustrates the emitted check"
}
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

See Automated Migration for details.

## See Also

- [Perspectives](../../fundamentals/perspectives/perspectives.md) - Understanding perspectives and Apply methods
- [StreamKey Attribute](streamkey.md) - Identifying stream keys for event ordering
- Automated Migration - Migrating from Marten/Wolverine
