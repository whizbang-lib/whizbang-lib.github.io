---
title: Caller Information Capture
pageType: concept
version: 1.0.0
category: Observability
order: 7
description: >-
  How Whizbang records the exact source location (method, file, line) that
  created each MessageHop, using C# caller-info compiler attributes with no
  reflection or stack walking.
tags: 'caller-info, observability, message-hops, debugging, compiler-attributes'
codeReferences:
  - src/Whizbang.Core/Observability/MessageHop.cs
  - src/Whizbang.Core/Observability/MessageTracing.cs
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/Dispatcher.cs
testReferences:
  - tests/Whizbang.Observability.Tests/MessageTracingTests.cs
  - tests/Whizbang.Observability.Tests/MessageHopTests.cs
---

# Caller information capture

Every `MessageHop` can record the **exact source location** that created it —
the calling method, its file path, and its line number. Whizbang gets this for
free from three C# compiler attributes, so the values are inlined at the call
site by the compiler: no reflection and no stack walking at runtime.

The captured location rides along on the hop and is serialized with the message,
so a hop always knows which line of code emitted it — the building block for
"jump to source" debugging and source-level audit trails across services.

This page is the caller-info companion to
[Observability & Message Hops](./observability.md), which covers the broader hop
model (`MessageEnvelope`, hop types, metadata stitching, policy trails).

## The three compiler attributes

C# injects call-site information into optional parameters marked with these
attributes. The compiler fills them in at each call site; the method body just
reads them like ordinary arguments.

| Attribute | Captures | Parameter type |
|---|---|---|
| `[CallerMemberName]` | Calling method / property name | `string` |
| `[CallerFilePath]` | Full source file path | `string` |
| `[CallerLineNumber]` | Line number of the call | `int` |

Because the values are literals baked in by the compiler, capture is
essentially free at runtime — there is no reflection and no stack unwinding.

## Where the caller info lives: `MessageHop`

`MessageHop` exposes the three captured values as nullable properties
(`src/Whizbang.Core/Observability/MessageHop.cs`):

```csharp{title="MessageHop's caller-info fields" description="The three nullable caller-info properties on MessageHop and the short JSON names they serialize under." category="Observability" difficulty="BEGINNER" tags=["Caller Info", "Message Hops", "Serialization", "Observability"]}
public record MessageHop {
    // ... routing, timing, security, policy, metadata ...

    // Caller information (auto-captured; enables "jump to line")
    public string? CallerMemberName { get; init; }  // JSON: "cm"
    public string? CallerFilePath   { get; init; }  // JSON: "cf"
    public int?    CallerLineNumber { get; init; }  // JSON: "cl"
}
```

All three are optional — a hop constructed without them leaves them `null`
(verified by `MessageHop_CallerInfo_CanBeNullAsync`). When serialized they use
the short property names `cm`, `cf`, `cl` and are omitted entirely when null. The
hop's custom `MessageHopConverter` reads either form: on deserialization it
accepts the short names **or** the legacy long names
(`CallerMemberName` / `CallerFilePath` / `CallerLineNumber`), so hops persisted
under the older format still round-trip.

> The XML doc comments on these fields describe them as enabling a future
> "jump to line" VSCode extension. That tooling is an intended use, not a
> shipped feature — treat it as forward-looking.

## How the framework captures it: the dispatcher path

The primary way caller info reaches a hop in production is through the
**dispatcher**. Several `IDispatcher` members — `SendAsync(message, context, …)`,
its `DispatchOptions` overload, and the `LocalInvokeAsync(…)` context overloads —
declare the three caller attributes as trailing optional parameters
(`src/Whizbang.Core/IDispatcher.cs`):

```csharp{title="IDispatcher.SendAsync caller-info parameters" description="The SendAsync overload declares the three caller attributes as trailing optional parameters the compiler fills at the call site." category="Observability" difficulty="INTERMEDIATE" tags=["Caller Info", "Dispatcher", "SendAsync", "Compiler Attributes"]}
Task<IDeliveryReceipt> SendAsync(
    object message,
    IMessageContext context,
    [CallerMemberName] string callerMemberName = "",
    [CallerFilePath]   string callerFilePath   = "",
    [CallerLineNumber] int    callerLineNumber = 0
);
```

When you call `dispatcher.SendAsync(message, context)`, the compiler injects
**your** call site's method, file, and line. `Dispatcher` then copies those
values onto the initial `MessageHop` it creates for the envelope
(`Dispatcher._createEnvelope`, `src/Whizbang.Core/Dispatcher.cs`):

```csharp{title="Dispatcher bakes the call site into the initial hop" description="_createEnvelope copies the captured caller member, file, and line onto the first MessageHop of every envelope." category="Observability" difficulty="ADVANCED" tags=["Caller Info", "Dispatcher", "Message Hops", "Internals"]}
var hop = new MessageHop {
    Type = HopType.Current,
    ServiceInstance = _instanceProvider.ToInfo(),
    Timestamp = DateTimeOffset.UtcNow,
    CorrelationId = context.CorrelationId,
    CausationId = context.CausationId,
    CallerMemberName = callerMemberName,   // ← your call site
    CallerFilePath   = callerFilePath,     // ← your call site
    CallerLineNumber = callerLineNumber,   // ← your call site
    Metadata = hopMetadata,
    Scope = _getScopeDeltaForHop(context),
    TraceParent = System.Diagnostics.Activity.Current?.Id
};
```

You do not pass these arguments — leaving them off is what lets the compiler
supply them. Pass explicit values and you defeat the mechanism.

## The `MessageTracing.RecordHop` helper

Whizbang also ships a small static helper,
`MessageTracing.RecordHop(...)` (`src/Whizbang.Core/Observability/MessageTracing.cs`),
that constructs a hop and captures caller info the same way. It takes a
`HopContext` value plus the three auto-captured parameters:

```csharp{title="MessageTracing.RecordHop signature" description="The static helper takes a HopContext plus the three auto-captured caller parameters." category="Observability" difficulty="INTERMEDIATE" tags=["Caller Info", "MessageTracing", "RecordHop", "API"]}
public static MessageHop RecordHop(
    HopContext context,
    [CallerMemberName] string? callerMemberName = null,
    [CallerFilePath]   string? callerFilePath   = null,
    [CallerLineNumber] int?    callerLineNumber = null
);
```

`HopContext` is a `readonly record struct` that groups the non-caller-info
inputs:

```csharp{title="HopContext groups the non-caller inputs" description="The readonly record struct carrying service instance, topic, stream key, strategy, and optional partition, sequence, and duration." category="Observability" difficulty="BEGINNER" tags=["Caller Info", "HopContext", "MessageTracing", "Records"]}
public readonly record struct HopContext(
    ServiceInstanceInfo ServiceInstance,
    string Topic,
    string StreamKey,
    string ExecutionStrategy,
    int?      PartitionIndex  = null,
    long?     SequenceNumber  = null,
    TimeSpan? Duration        = null);
```

Usage — supply the context and let the compiler fill the rest:

```csharp{title="Calling RecordHop and letting the compiler fill caller info" description="Supply the HopContext only; the caller member, file, and line for this call site are injected automatically." category="Observability" difficulty="BEGINNER" tags=["Caller Info", "RecordHop", "Usage", "MessageTracing"]}
var hop = MessageTracing.RecordHop(
    new HopContext(serviceInstance, "orders", "order-123", "SerialExecutor"));

// hop.CallerMemberName / CallerFilePath / CallerLineNumber
// are set to THIS call site automatically.
```

`RecordHop` maps `HopContext.StreamKey` onto the hop's `StreamId` field, sets
`Duration` (defaulting to `TimeSpan.Zero` when the context omits it), and
captures the current `Activity.Id` into `TraceParent`. It does **not** compute a
service name or host — those come from the `ServiceInstanceInfo` you pass in.

> In the current codebase the framework's own pipeline builds hops directly (via
> `Dispatcher._createEnvelope`), not through `RecordHop`. `RecordHop` is a public
> helper exercised by the observability tests; reach for it when you build hops
> yourself.

## Capture is at the call site, not the definition site

The attributes capture where the wrapped method is **called from**, not where it
is defined. That is what makes wrapper and extension methods work: put the
attributed parameters on your wrapper, forward them through, and the value comes
from your wrapper's caller.

The tests prove this: two different helper methods that each call `RecordHop`
produce different `CallerMemberName` and `CallerLineNumber` values — the name of
the *helper*, not `RecordHop`
(`RecordHop_FromDifferentMethods_CapturesDifferentCallerInfoAsync`,
`RecordHop_CapturesCallerMemberName_AutomaticallyAsync`).

```csharp{title="A wrapper that forwards caller attributes" description="Put the attributed parameters on your own helper and forward them to RecordHop so the captured location is the wrapper's caller." category="Observability" difficulty="INTERMEDIATE" tags=["Caller Info", "Wrapper Methods", "RecordHop", "Extension Points"]}
public static class CustomTracing {
    public static MessageHop CreateOrderHop(
        ServiceInstanceInfo serviceInstance,
        Guid orderId,
        [CallerMemberName] string? callerMemberName = null,
        [CallerFilePath]   string? callerFilePath   = null,
        [CallerLineNumber] int?    callerLineNumber = null
    ) =>
        MessageTracing.RecordHop(
            new HopContext(serviceInstance, "orders", $"order-{orderId}", "SerialExecutor"),
            callerMemberName, callerFilePath, callerLineNumber);
}

// The captured caller info comes from whoever calls CreateOrderHop,
// not from inside CreateOrderHop.
var hop = CustomTracing.CreateOrderHop(serviceInstance, orderId);
```

## Common mistakes

**Passing literal values.** Supplying the caller parameters yourself overrides
what the compiler would inject, so the hop points at whatever you typed instead
of the real call site. Omit them and let the compiler win.

**Calling through a lambda or delegate.** Caller attributes are resolved once,
where the invocation appears in source. A lambda that calls `RecordHop` bakes in
the lambda body's location, so every invocation of that lambda reports the same
line — not the line that invoked the lambda. Call the attributed method directly
at each site where you want a distinct location.

**Burying the call in a multi-line expression.** The captured line number is the
line of the invocation, which can be surprising when arguments span multiple
lines. Keep the call on its own statement if the line matters.

## Testing caller capture

Because line numbers shift when you edit a file, assert that the value was
captured (not a brittle exact number). The observability tests follow this
pattern with TUnit:

```csharp{title="Assert caller info was captured, not an exact line" description="The observability tests assert presence and shape (non-null, greater than zero) so edits that shift line numbers don't break them." category="Observability" difficulty="INTERMEDIATE" tags=["Caller Info", "Testing", "TUnit", "Observability"]}
[Test]
public async Task RecordHop_CapturesCallerLineNumber_AutomaticallyAsync() {
    var hop = _testMethod_ThatRecordsHop();

    await Assert.That(hop.CallerLineNumber).IsNotNull();
    await Assert.That(hop.CallerLineNumber!.Value).IsGreaterThan(0);
}
```

`RecordHop_CapturesCallerFilePath_AutomaticallyAsync` asserts the path
`EndsWith("MessageTracingTests.cs")`, and
`RecordHop_CapturesCallerMemberName_AutomaticallyAsync` asserts the member name
equals the calling helper. Assert **presence and shape**, not exact position.

## Further reading

- [Observability & Message Hops](./observability.md) — the full hop model:
  `MessageEnvelope`, `HopType`, metadata stitching, policy decision trails.
- [Message context](../messages/message-context.md) — `MessageId`,
  `CorrelationId`, `CausationId`.
