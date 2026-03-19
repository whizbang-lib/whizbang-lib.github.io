---
title: 'WHIZ080: Multiple Handlers for RPC Message'
description: >-
  Warning diagnostic when multiple handlers are registered for a message type
  that returns a response (RPC pattern)
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - rpc
  - receptor
  - handler
  - source-generator
---

# WHIZ080: Multiple Handlers for RPC Message

**Severity**: Warning
**Category**: Handler Validation

## Description

This warning is reported when multiple receptor implementations are found for a message type that returns a response (RPC pattern). Since RPC calls expect a single response, having multiple handlers creates ambiguity about which response to return.

**Note**: This diagnostic is disabled by default pending implementation of key-based RPC handler selection.

## Diagnostic Message

```
Multiple handlers found for 'GetOrderQuery' which returns a response (found: 2), but RPC requires exactly one handler
```

## Understanding RPC vs Event Patterns

### RPC Pattern (Single Handler Expected)

RPC (Remote Procedure Call) pattern uses `IReceptor<TMessage, TResponse>` where a response is returned:

```csharp
// Query expecting a single response
public record GetOrderQuery(Guid OrderId);
public record OrderDto(Guid Id, string Status, decimal Total);

// Single handler expected
public class OrderQueryReceptor : IReceptor<GetOrderQuery, OrderDto> {
  public Task<OrderDto> HandleAsync(GetOrderQuery query) {
    // Return the order data
    return Task.FromResult(new OrderDto(...));
  }
}
```

### Event Pattern (Multiple Handlers Allowed)

For void receptors (event handlers), multiple handlers are expected:

```csharp
// Event broadcast to multiple handlers - OK
public record OrderPlaced(Guid OrderId) : IEvent;

public class InventoryReceptor : IReceptor<OrderPlaced> {
  public Task HandleAsync(OrderPlaced @event) => ...;
}

public class NotificationReceptor : IReceptor<OrderPlaced> {
  public Task HandleAsync(OrderPlaced @event) => ...;
}
```

## Why Multiple RPC Handlers Are Problematic

When you have multiple handlers for an RPC message:

1. **Ambiguous Response** - Which handler's response should be returned?
2. **Unpredictable Behavior** - Handler execution order is not guaranteed
3. **Contract Violation** - Caller expects one definitive response

## How to Fix

### Option 1: Remove Duplicate Handlers

Keep only one handler for the RPC message:

```csharp
// Keep only one handler
public class OrderQueryReceptor : IReceptor<GetOrderQuery, OrderDto> {
  public Task<OrderDto> HandleAsync(GetOrderQuery query) => ...;
}

// Remove or consolidate the second handler
// public class CachedOrderQueryReceptor : IReceptor<GetOrderQuery, OrderDto> { }
```

### Option 2: Use Decorator Pattern

If you need caching or cross-cutting concerns, use the decorator pattern:

```csharp
public class CachedOrderQueryReceptor : IReceptor<GetOrderQuery, OrderDto> {
  private readonly OrderQueryReceptor _inner;
  private readonly ICache _cache;

  public async Task<OrderDto> HandleAsync(GetOrderQuery query) {
    var cached = await _cache.GetAsync<OrderDto>(query.OrderId);
    if (cached != null) return cached;

    var result = await _inner.HandleAsync(query);
    await _cache.SetAsync(query.OrderId, result);
    return result;
  }
}
```

### Option 3: Use Different Message Types

If handlers serve different purposes, use distinct message types:

```csharp
// Separate queries for different purposes
public record GetOrderQuery(Guid OrderId);
public record GetOrderWithDetailsQuery(Guid OrderId);

public class OrderQueryReceptor : IReceptor<GetOrderQuery, OrderDto> { }
public class OrderDetailsReceptor : IReceptor<GetOrderWithDetailsQuery, OrderDetailsDto> { }
```

## Future: Key-Based Handler Selection

A future Whizbang release will support key-based RPC handler selection using `[RpcKey]`:

```csharp
// Future syntax (not yet implemented)
[RpcKey("default")]
public class DefaultOrderReceptor : IReceptor<GetOrderQuery, OrderDto> { }

[RpcKey("cached")]
public class CachedOrderReceptor : IReceptor<GetOrderQuery, OrderDto> { }

// Caller specifies which handler to use
var result = await dispatcher.InvokeAsync<GetOrderQuery, OrderDto>(query, rpcKey: "cached");
```

## Configuration

This diagnostic is disabled by default. To enable:

```xml
<PropertyGroup>
  <WarningsAsErrors>$(WarningsAsErrors);WHIZ080</WarningsAsErrors>
</PropertyGroup>
```

Or in an `.editorconfig`:

```ini
[*.cs]
dotnet_diagnostic.WHIZ080.severity = warning
```

## Related Concepts

- **LocalInvoke** - The RPC dispatch method that expects a single response
- **Receptors** - Handler implementations for messages
- **Dispatcher** - Routes messages to appropriate handlers

## See Also

- [Receptors](../core-concepts/receptors.md) - Receptor implementation patterns
- [Dispatcher](../core-concepts/dispatcher.md) - Message routing
- [CQRS Pattern](../patterns/cqrs.md) - Command Query Responsibility Segregation
