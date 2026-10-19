---
title: Receptor Priority
pageType: concept
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
version: 1.0.0
category: Core Concepts
order: 3
description: >-
  Every receptor a service has for a message runs, on every call, in the order
  its [ReceptorPriority] declares. Lower runs first; a receptor that declares
  nothing runs in the middle.
tags: >-
  receptors, priority, ordering, ReceptorPriority, multiple receptors, mediator,
  local invoke, send
codeReferences:
  - src/Whizbang.Core/Messaging/ReceptorPriorityAttribute.cs
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Generators/ReceptorDiscoveryGenerator.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Dispatcher/EveryReceptorInPriorityOrderComponentTests.cs
  - tests/Whizbang.Generators.Tests/ReceptorPriorityAndMediatorEmissionTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# Receptor Priority

A service can have several receptors for the same message. **Every one of them runs, on every call**:
`SendAsync`, `SendManyAsync`, `LocalSendManyAsync`, `LocalInvokeAsync` (with or without a result) and
`PublishAsync` all run the full set. `[ReceptorPriority]` decides the order.

## Declaring a priority

Lower values run first. A receptor without the attribute runs at `ReceptorPriority.DEFAULT` (500), the
middle of the range, so you can place a receptor before or after the ones that declare nothing.

| Constant | Value | Use it for |
|----------|-------|------------|
| `ReceptorPriority.FIRST` | 0 | Guards and validation that must see the message before anything else |
| `ReceptorPriority.EARLY` | 250 | Work the default receptors depend on |
| `ReceptorPriority.DEFAULT` | 500 | Everything that declares nothing |
| `ReceptorPriority.LATE` | 750 | Work that should follow the default receptors |
| `ReceptorPriority.LAST` | 1000 | Auditing and notification after everything else |

Any integer works; the constants name the usual points.

```csharp{title="Ordering receptors for one command" description="Three receptors for the same command run in priority order" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Receptors", "Priority"] tests=["EveryReceptorInPriorityOrderComponentTests.EveryEntry_RunsEveryLocalReceptorInPriorityOrderAsync", "EveryReceptorInPriorityOrderComponentTests.Publish_RunsEveryLocalReceptorInPriorityOrderAsync", "ReceptorPriorityAndMediatorEmissionTests.Runner_IsEmittedForAMessageWithSeveralReceptors_InPriorityOrderAsync"]}
[ReceptorPriority(ReceptorPriority.FIRST)]
public class ValidateShipment : IReceptor<ShipOrder> {
  public ValueTask HandleAsync(ShipOrder command, CancellationToken ct = default) { /* runs first */ }
}

public class ReserveCarrier : IReceptor<ShipOrder> {
  public ValueTask HandleAsync(ShipOrder command, CancellationToken ct = default) { /* runs second (DEFAULT) */ }
}

[ReceptorPriority(ReceptorPriority.LAST)]
public class AuditShipment : IReceptor<ShipOrder> {
  public ValueTask HandleAsync(ShipOrder command, CancellationToken ct = default) { /* runs last */ }
}

await dispatcher.SendAsync(new ShipOrder(orderId)); // all three run, in that order
```

Receptors with the same priority run in declaration order.

## When the caller asks for a result

`LocalInvokeAsync<TMessage, TResult>` returns one value. When several receptors return a `TResult`, the
**earliest by priority answers the caller**. The others still run, and what they return
[cascades](../dispatcher/message-cascade) like any other receptor result.

```csharp{title="The earliest answering receptor returns the result" description="Two receptors answer; the earlier one's result is returned and the other still runs" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Receptors", "Priority", "LocalInvoke"] tests=["EveryReceptorInPriorityOrderComponentTests.LocalInvokeForAResult_ReturnsTheEarliestAnsweringReceptorsResult_AndRunsTheRestAsync", "ReceptorPriorityAndMediatorEmissionTests.SendLookups_PickTheEarliestReceptorByPriorityAsync"]}
[ReceptorPriority(ReceptorPriority.EARLY)]
public class QuoteFromCache : IReceptor<GetQuote, Quote> { /* answers the caller */ }

public class QuoteFromCarrier : IReceptor<GetQuote, Quote> { /* runs too; its Quote cascades */ }

var quote = await dispatcher.LocalInvokeAsync<GetQuote, Quote>(new GetQuote(orderId)); // QuoteFromCache's
```

## Where the order holds

The order holds among the receptors of one assembly. Receptors from other assemblies run after this
assembly's own, and receptors registered at runtime run after both.

A message with a single receptor takes the same direct path it always did, so priority costs nothing
until a second receptor exists.

## Related

- [Receptors](receptors)
- [Lifecycle Receptors](lifecycle-receptors)
- [Exactly-Once Receptor Firing](exactly-once-firing)
- [Message Cascade](../dispatcher/message-cascade)
