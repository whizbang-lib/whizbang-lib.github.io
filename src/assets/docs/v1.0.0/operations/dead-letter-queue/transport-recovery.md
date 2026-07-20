---
title: Transport DLQ Recovery
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Dead-Letter Queue
order: 4
description: >-
  How TransportDeadLetterDrainWorker drains the broker's own dead-letter
  queue (ASB $DeadLetterQueue, RMQ DLX queue) back onto the normal
  receive path. Distinct from Whizbang's internal wh_dead_letters flow.
tags: >-
  dead-letter-queue, transport-recovery, ITransportDeadLetterDrainer,
  TransportDeadLetterDrainWorker, ASB, RabbitMQ, broker-DLQ
codeReferences:
  - src/Whizbang.Core/Transports/ITransportDeadLetterDrainer.cs
  - src/Whizbang.Core/Workers/TransportDeadLetterDrainWorker.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusDeadLetterDrainer.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMqDeadLetterDrainer.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/TransportDeadLetterDrainWorkerTests.cs
  - tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusDeadLetterDrainerTests.cs
  - tests/Whizbang.Transports.RabbitMQ.Tests/RabbitMqDeadLetterDrainerTests.cs
---

# Transport DLQ Recovery

The transport DLQ flow is independent of the internal `wh_dead_letters`
table. It exists to keep broker-side dead-letter queues from growing
unbounded when a transient delivery issue caused the broker itself to
drop messages.

## Why a separate flow?

Whizbang's event store is source of truth. When a broker DLQs a message,
the underlying event still replays from `wh_event_store` via the normal
claim path — no data is lost. But the broker's DLQ doesn't know that. It
holds onto messages forever (or up to the broker's retention cap), pages
operators about queue depth, and ultimately needs someone to drain it.

`TransportDeadLetterDrainWorker` does that drain automatically on a
backstop interval (default 10 min). Each registered
`ITransportDeadLetterDrainer` reads up to `MaxPerTick` (default 500)
messages from its broker's DLQ and re-publishes them onto the normal
receive path. If the underlying failure is permanent the message lands
back in DLQ; the next sweep re-tries it. The cadence is intentionally
slow — broker DLQ recovery isn't latency-sensitive.

## Defaults

Configure via `TransportDeadLetterDrainWorkerOptions` — registered with
`AddOptions()` and not auto-bound from `appsettings.json`:

```csharp{
title: "Configure the transport DLQ drain worker"
description: "Options defaults controlling the broker DLQ drain backstop — enable flag, sweep interval, and the per-tick message cap."
framework: "NET10"
category: "Operations"
difficulty: "BEGINNER"
tags: ["dead-letter", "transport-recovery", "TransportDeadLetterDrainWorkerOptions", "configuration"]
unverified: "DI configuration snippet — options set via Configure; no framework unit under test on this page"
}
services.Configure<TransportDeadLetterDrainWorkerOptions>(o => {
  o.Enabled = true;        // killswitch (default true)
  o.IntervalMinutes = 10;  // backstop cadence between sweeps (default 10)
  o.MaxPerTick = 500;      // max messages re-submitted per drainer per tick (default 500)
});
```

`Enabled = false` is the killswitch — broker DLQs stay full until an
operator drains them manually via broker-side tooling.

Drainers are not auto-registered by the transport hosting extensions at
this release — register one `ITransportDeadLetterDrainer` per subscription
/ queue as shown below. With no drainers registered, the worker idles.

## Azure Service Bus

`AzureServiceBusDeadLetterDrainer` reads from
`<topic>/Subscriptions/<sub>/$DeadLetterQueue` and re-sends each message
back to `<topic>` using a fresh `ServiceBusMessage`. Body, content type,
application properties, and routing fields (`subject`, `correlationId`,
`messageId`, `sessionId`, `partitionKey`, `to`, `replyTo`,
`replyToSessionId`) are copied; `DeliveryCount` resets on the new
message.

Registration (one per subscription):

```csharp{
title: "Register an Azure Service Bus dead-letter drainer"
description: "Wires an AzureServiceBusDeadLetterDrainer per subscription so the worker can drain the ASB $DeadLetterQueue back onto the topic's receive path."
framework: "NET10"
category: "Operations"
difficulty: "INTERMEDIATE"
tags: ["dead-letter", "transport-recovery", "azure-service-bus", "ITransportDeadLetterDrainer"]
tests: ["AzureServiceBusDeadLetterDrainerTests.TransportName_FormatsAsAsbTopicSubAsync"]
}
services.AddSingleton<ITransportDeadLetterDrainer>(sp =>
  new AzureServiceBusDeadLetterDrainer(
    client: sp.GetRequiredService<ServiceBusClient>(),
    topicName: "orders",
    subscriptionName: "inventory-svc",
    logger: sp.GetRequiredService<ILogger<AzureServiceBusDeadLetterDrainer>>()));
```

`TransportName` becomes `asb:orders/inventory-svc` — used as the
`transport` dimension on the `whizbang.transport_dlq.drained` counter.

## RabbitMQ

`RabbitMqDeadLetterDrainer` reads from the configured DLQ via
`BasicGetAsync`, resolves the original `(exchange, routing-key)` from the
`x-death` header that RabbitMQ attaches when a message enters DLQ, and
re-publishes via `BasicPublishAsync`. Falls back to a configured default
exchange + the message's current routing key when the header is missing
(rare; only happens if the broker stripped it).

Registration:

```csharp{
title: "Register a RabbitMQ dead-letter drainer"
description: "Wires a RabbitMqDeadLetterDrainer that reads the DLQ, resolves the original exchange/routing-key from the x-death header, and re-publishes with a fallback exchange."
framework: "NET10"
category: "Operations"
difficulty: "INTERMEDIATE"
tags: ["dead-letter", "transport-recovery", "rabbitmq", "ITransportDeadLetterDrainer"]
tests: ["RabbitMqDeadLetterDrainerTests.TransportName_FormatsAsRmqDlqAsync"]
}
services.AddSingleton<ITransportDeadLetterDrainer>(sp =>
  new RabbitMqDeadLetterDrainer(
    connection: sp.GetRequiredService<IConnection>(),
    dlqName: "orders.dlq",
    fallbackExchange: "orders",
    logger: sp.GetRequiredService<ILogger<RabbitMqDeadLetterDrainer>>()));
```

`TransportName` becomes `rmq:orders.dlq`.

## Failure handling

Both implementations are best-effort:

- ASB: if `SendMessageAsync` or `CompleteMessageAsync` throws, the
  message is `AbandonMessageAsync`-ed back to DLQ for the next sweep.
- RMQ: if `BasicPublishAsync` or `BasicAckAsync` throws, the message is
  `BasicNackAsync`-ed with `requeue: true` so it stays in DLQ.

A single drainer failing doesn't stop the others — the worker continues
through the remaining drainers on the current tick.

## On-demand drain

The worker exposes `DrainOnceAsync(CancellationToken)` publicly so
operator endpoints can trigger an immediate sweep without waiting for
the next interval:

```csharp{
title: "Trigger an on-demand broker DLQ drain"
description: "Maps an operator endpoint that calls DrainOnceAsync to sweep every registered transport drainer immediately instead of waiting for the next interval tick."
framework: "NET10"
category: "Operations"
difficulty: "INTERMEDIATE"
tags: ["dead-letter", "transport-recovery", "DrainOnceAsync", "operator-endpoint"]
unverified: "ASP.NET endpoint-wiring illustration — MapPost/RequireAuthorization are user wiring; the DrainOnceAsync sweep it calls is verified by TransportDeadLetterDrainWorkerTests"
}
app.MapPost("/admin/transport-dlq/drain-now", async (
    TransportDeadLetterDrainWorker worker,
    CancellationToken ct) => {
  await worker.DrainOnceAsync(ct);
  return Results.NoContent();
}).RequireAuthorization("WhizbangOperator");
```

## Telemetry

| Metric | Meter | Type | Dimensions |
|---|---|---|---|
| `whizbang.transport_dlq.drained` | `Whizbang.TransportDeadLetterDrain` | counter | `transport` (e.g. `asb:orders/inventory-svc`) |

Worker also exposes `TotalDrained` (a `long`) for in-process introspection
— useful for tests and health endpoints.

## See also

- [Internal DLQ table](./internal-dlq) — the policy-driven sibling flow
- [Recovery worker + policy matrix](./recovery)
