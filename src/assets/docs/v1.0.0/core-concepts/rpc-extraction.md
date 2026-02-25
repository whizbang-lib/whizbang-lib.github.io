# RPC Response Extraction

RPC (Remote Procedure Call) style invocations allow you to call a receptor and receive a specific response type back, while other returned values cascade through normal routing.

## Overview

When using `LocalInvokeAsync<TResponse>(command)`, the dispatcher:

1. **Extracts** the requested `TResponse` type from the receptor's return value
2. **Returns** that value directly to the caller
3. **Cascades** all other returned values through normal routing (outbox by default)

This enables receptors to return multiple values (via tuples) while callers receive only what they need.

## Example

```csharp
// Command
public record CreateOrder(Guid OrderId, decimal Amount);

// Response types
public record OrderConfirmation {
  public required Guid OrderId { get; init; }
  public required string ConfirmationCode { get; init; }
}

[DefaultRouting(DispatchMode.Outbox)]
public record InventoryReserved([property: StreamKey] Guid OrderId) : IEvent;

// Receptor returns tuple: (response to caller, event to cascade)
public class CreateOrderReceptor
    : IReceptor<CreateOrder, (OrderConfirmation, InventoryReserved)> {

  public ValueTask<(OrderConfirmation, InventoryReserved)> HandleAsync(
      CreateOrder command,
      CancellationToken ct = default) {

    var confirmation = new OrderConfirmation {
      OrderId = command.OrderId,
      ConfirmationCode = $"CONF-{command.OrderId:N}"
    };

    var inventory = new InventoryReserved(command.OrderId);

    return ValueTask.FromResult((confirmation, inventory));
  }
}
```

### Caller Side

```csharp
// RPC call - OrderConfirmation returned to caller
var confirmation = await dispatcher.LocalInvokeAsync<OrderConfirmation>(
    new CreateOrder(Guid.NewGuid(), 99.99m));

// InventoryReserved automatically cascades to outbox (per [DefaultRouting])
// confirmation.ConfirmationCode is available to caller
```

## How It Works

### Response Extraction

The `ResponseExtractor` utility extracts the requested type from complex return values:

| Return Type | Extraction Behavior |
|-------------|---------------------|
| Single value | Direct match returns immediately |
| Tuple `(A, B, C)` | Searches each element for match |
| Array/List | Searches each element for match |
| `Routed<T>` wrapper | Unwraps and extracts from inner value |

### Cascade Exclusion

After extraction, remaining values cascade based on their routing:

- **Extracted response**: Returned to RPC caller (NOT cascaded)
- **Other `IEvent` values**: Cascade per routing (`[DefaultRouting]` or wrapper)
- **Non-message values**: Ignored (not cascaded)

### Routing Wrappers Ignored for RPC

RPC responses are extracted regardless of routing wrappers:

```csharp
// Even if wrapped in Route.Local() or Route.Outbox(),
// the value is still extracted and returned to RPC caller
return (Route.Local(confirmation), inventory);
// confirmation goes to caller, inventory cascades
```

## Supported Return Types

### Tuples (2-8 elements)

```csharp
// 2-tuple
IReceptor<Cmd, (Response, Event)>

// 3-tuple
IReceptor<Cmd, (Response, Event1, Event2)>
```

### Mixed with Routing

```csharp
// Explicit routing on cascaded events
IReceptor<Cmd, (Response, Routed<CacheInvalidated>)>
```

### Interface-Based Extraction

```csharp
// Extract by interface
var evt = await dispatcher.LocalInvokeAsync<IEvent>(command);
// Returns first IEvent found in tuple
```

## Discriminated Unions

Receptors can return discriminated union-style tuples where only one value is populated and others are explicitly empty using `Route.None()` or `null`.

### Using Route.None()

`Route.None()` explicitly marks a tuple position as "no value":

```csharp
// Receptor returning success OR failure
public class ProcessPaymentReceptor
    : IReceptor<ProcessPayment, (PaymentSucceeded?, PaymentFailed?)> {

  public async ValueTask<(PaymentSucceeded?, PaymentFailed?)> HandleAsync(
      ProcessPayment command,
      CancellationToken ct = default) {

    var result = await _paymentService.ProcessAsync(command);

    if (result.Success) {
      // Success path - failure is Route.None()
      return (new PaymentSucceeded(command.PaymentId), null);
    } else {
      // Failure path - success is null
      return (null, new PaymentFailed(command.PaymentId, result.Error));
    }
  }
}
```

### Extracting from Discriminated Unions

The caller extracts whichever value is present:

```csharp
// Try to extract success
var success = await dispatcher.LocalInvokeAsync<PaymentSucceeded>(command);
// Returns PaymentSucceeded if success path was taken
// Throws InvalidOperationException if failure path (success was null)
```

### Explicit Route.None() Syntax

For more explicit code, use `Route.None()` instead of `null`:

```csharp
return (success: Route.None(), failure: new PaymentFailed(...));
```

`Route.None()` values are:
- **Never extracted** as RPC responses
- **Never cascaded** as events
- **AOT-compatible** (simple struct with `DispatchMode.None`)

### Three-Way Unions

Discriminated unions can have more than two paths:

```csharp
// Success, validation error, or system error
IReceptor<Cmd, (SuccessResult?, ValidationError?, SystemError?)>

// Implementation
return command.Amount < 0
    ? (null, new ValidationError("Amount must be positive"), null)
    : command.Amount > 10000
    ? (null, null, new SystemError("Amount exceeds limit"))
    : (new SuccessResult(command.Amount), null, null);
```

## Error Handling

### Type Not Found

If the requested type doesn't exist in the return value:

```csharp
// Receptor returns (OrderConfirmation, InventoryReserved)
// But caller requests PaymentProcessed
await dispatcher.LocalInvokeAsync<PaymentProcessed>(command);
// Throws InvalidOperationException
```

### Multiple Matches

If multiple values match the requested type, the **first** match is returned:

```csharp
// Tuple: (OrderCreated{Id="first"}, OrderCreated{Id="second"})
var order = await dispatcher.LocalInvokeAsync<OrderCreated>(command);
// order.Id == "first"
```

## Performance Considerations

### Fast Path (Exact Match)

When the receptor's return type exactly matches `TResponse`, no extraction is needed:

```csharp
// Receptor: IReceptor<Cmd, OrderConfirmation>
// Caller: LocalInvokeAsync<OrderConfirmation>(cmd)
// Result: Fast path - no extraction overhead
```

### Extraction Path

When types differ, extraction adds minimal overhead:

- Uses `ITuple` interface (AOT-compatible)
- No reflection - pattern matching only
- Single pass through tuple elements

## AOT Compatibility

RPC extraction is fully AOT-compatible:

- Uses `ITuple` interface for tuple handling
- Pattern matching with `is TResponse`
- No `Type.GetType()` or reflection APIs
- `ReferenceEquals` for cascade exclusion

## Best Practices

1. **Return tuples for multi-value responses**
   - Clear separation between RPC response and events
   - Explicit about what cascades vs returns

2. **Use `[DefaultRouting]` on events**
   - Cascaded events route automatically
   - No need for explicit `Route.Outbox()` wrappers

3. **Request specific types**
   - Avoid interface-based extraction when possible
   - More predictable behavior with concrete types

4. **Handle extraction failures**
   - Wrap calls in try-catch for production code
   - Log when extraction fails for debugging

## Related Documentation

- [Dispatcher](dispatcher.md) - Core dispatch mechanics
- [Receptors](receptors.md) - Handler implementation
- [Message Routing](../messaging/routing.md) - Routing configuration
