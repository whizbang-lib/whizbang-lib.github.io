---
title: 'WHIZ080: Multiple Handlers for RPC Message'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/ReceptorDiscoveryGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/ReceptorDiscoveryGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# WHIZ080: Multiple Handlers for RPC Message

**Severity**: Warning
**Category**: Handler Validation

## Description

This warning is reported when multiple **async** receptor implementations (`IReceptor<TMessage, TResponse>`) are found for a message type that returns a response (RPC pattern). Since RPC calls expect a single response, having multiple handlers creates ambiguity about which response to return.

Void receptors (`IReceptor<TMessage>`, event-style dispatch) and sync receptors (`ISyncReceptor`) are excluded — multiple handlers are allowed for those.

**Note**: This diagnostic is disabled by default pending implementation of key-based RPC handler selection.

## Diagnostic Message

The second placeholder lists the conflicting handler class names:

```
Multiple handlers found for 'GetOrderQuery' which returns a response (found: OrderQueryReceptor, CachedOrderQueryReceptor), but RPC requires exactly one handler
```

## Understanding RPC vs Event Patterns

### RPC Pattern (Single Handler Expected)

RPC (Remote Procedure Call) pattern uses `IReceptor<TMessage, TResponse>` where a response is returned:

```csharp{title="RPC Pattern (Single Handler Expected)" description="RPC (Remote Procedure Call) pattern uses IReceptor<TMessage, TResponse> where a response is returned:" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "RPC", "Pattern"]}
// Query expecting a single response
public record GetOrderQuery(Guid OrderId);
public record OrderDto(Guid Id, string Status, decimal Total);

// Single handler expected
public class OrderQueryReceptor : IReceptor<GetOrderQuery, OrderDto> {
  public ValueTask<OrderDto> HandleAsync(GetOrderQuery query, CancellationToken cancellationToken = default) {
    // Return the order data
    return ValueTask.FromResult(new OrderDto(...));
  }
}
```

### Event Pattern (Multiple Handlers Allowed)

For void receptors (event handlers), multiple handlers are expected:

```csharp{title="Event Pattern (Multiple Handlers Allowed)" description="For void receptors (event handlers), multiple handlers are expected:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Event", "Pattern"] tests=["ReceptorDiscoveryGeneratorTests.Generator_WithMultipleVoidHandlers_NoErrorAsync"]}
// Event broadcast to multiple handlers - OK
public record OrderPlaced(Guid OrderId) : IEvent;

public class InventoryReceptor : IReceptor<OrderPlaced> {
  public ValueTask HandleAsync(OrderPlaced @event, CancellationToken cancellationToken = default) => ...;
}

public class NotificationReceptor : IReceptor<OrderPlaced> {
  public ValueTask HandleAsync(OrderPlaced @event, CancellationToken cancellationToken = default) => ...;
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

```csharp{title="Option 1: Remove Duplicate Handlers" description="Keep only one handler for the RPC message:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Option", "Remove"]}
// Keep only one handler
public class OrderQueryReceptor : IReceptor<GetOrderQuery, OrderDto> {
  public ValueTask<OrderDto> HandleAsync(GetOrderQuery query, CancellationToken cancellationToken = default) => ...;
}

// Remove or consolidate the second handler
// public class CachedOrderQueryReceptor : IReceptor<GetOrderQuery, OrderDto> { }
```

### Option 2: Use Decorator Pattern

If you need caching or cross-cutting concerns, use the decorator pattern:

```csharp{title="Option 2: Use Decorator Pattern" description="If you need caching or cross-cutting concerns, use the decorator pattern:" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Option", "Decorator"]}
public class CachedOrderQueryReceptor : IReceptor<GetOrderQuery, OrderDto> {
  private readonly OrderQueryReceptor _inner;
  private readonly ICache _cache;

  public async ValueTask<OrderDto> HandleAsync(GetOrderQuery query, CancellationToken cancellationToken = default) {
    var cached = await _cache.GetAsync<OrderDto>(query.OrderId);
    if (cached != null) return cached;

    var result = await _inner.HandleAsync(query, cancellationToken);
    await _cache.SetAsync(query.OrderId, result);
    return result;
  }
}
```

### Option 3: Use Different Message Types

If handlers serve different purposes, use distinct message types:

```csharp{title="Option 3: Use Different Message Types" description="If handlers serve different purposes, use distinct message types:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Option", "Different"]}
// Separate queries for different purposes
public record GetOrderQuery(Guid OrderId);
public record GetOrderWithDetailsQuery(Guid OrderId);

public class OrderQueryReceptor : IReceptor<GetOrderQuery, OrderDto> { }
public class OrderDetailsReceptor : IReceptor<GetOrderWithDetailsQuery, OrderDetailsDto> { }
```

## Future: Key-Based Handler Selection

A future Whizbang release will support key-based RPC handler selection using `[RpcKey]`:

```csharp{title="Future: Key-Based Handler Selection" description="A future Whizbang release will support key-based RPC handler selection using [RpcKey]:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Future:", "Key-Based"] unverified="not yet implemented — RpcKey is future syntax with no test"}
// Future syntax (not yet implemented)
[RpcKey("default")]
public class DefaultOrderReceptor : IReceptor<GetOrderQuery, OrderDto> { }

[RpcKey("cached")]
public class CachedOrderReceptor : IReceptor<GetOrderQuery, OrderDto> { }

// Caller specifies which handler to use
var result = await dispatcher.InvokeAsync<GetOrderQuery, OrderDto>(query, rpcKey: "cached");
```

## Configuration

This diagnostic is disabled by default (`isEnabledByDefault: false`). It is reported at compilation level with no source location, so a per-file `.editorconfig` section (`[*.cs]`) cannot enable it — use a global analyzer config file instead:

```ini{title="Configuration" description="Enable WHIZ080 via .globalconfig:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Configuration"]}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ080.severity = warning
```

Note that `<WarningsAsErrors>` alone does not enable a disabled-by-default diagnostic — it only changes the severity of diagnostics that are already being reported.

## Related Concepts

- **LocalInvoke** - The RPC dispatch method that expects a single response
- **Receptors** - Handler implementations for messages
- **Dispatcher** - Routes messages to appropriate handlers

## See Also

- [Receptors](../../fundamentals/receptors/receptors.md) - Receptor implementation patterns
- [Dispatcher](../../fundamentals/dispatcher/dispatcher.md) - Message routing
- CQRS Pattern - Command Query Responsibility Segregation
