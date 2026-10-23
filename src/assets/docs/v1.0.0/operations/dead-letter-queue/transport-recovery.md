---
title: Transport DLQ Recovery
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
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
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusFleetDeadLetterDrainer.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusNamespacesDeadLetterDrainer.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMqDeadLetterDrainer.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RecoveredBrokerDeadLetterDispatchIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/BrokerDeadLetterImportSqlTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportDeadLetterDrainWorkerTests.cs
  - tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusDeadLetterDrainerTests.cs
  - tests/Whizbang.Transports.AzureServiceBus.Tests/AsbNamespacesDeadLetterDrainerTests.cs
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

### Every subscription in every namespace {#multiple-namespaces}

`AddAzureServiceBusTransport` registers one drainer for you, so the manual registration above is
only for a subscription the transport does not manage. On every pass it drains each subscription
the transport has opened, including ones opened after startup.

A host given more than one Service Bus namespace (a `TransportNamespace` connection beside the
default) resolves its transport as a router with one Service Bus transport per namespace. The drainer
covers each of them, and reads each namespace's dead-letter queues through that namespace's own
client: the default namespace's client cannot read another namespace's queues, and two namespaces
may use the same topic and subscription names.

| Behavior | |
|---|---|
| Every namespace behind the router is drained | {verified: AsbNamespacesDeadLetterDrainerTests.ServiceBusTransportsOf_ANamespaceRouter_IsEveryNamespacesTransportAsync} |
| The same topic and subscription in two namespaces are two queues, both drained | {verified: AsbNamespacesDeadLetterDrainerTests.DrainDeadLetterQueueAsync_TwoNamespacesWithTheSameSubscription_DrainsBothAsync} |
| The worker's per-pass limit is one total across namespaces, not per namespace, so it still paces broker operations | {verified: AsbNamespacesDeadLetterDrainerTests.DrainDeadLetterQueueAsync_BudgetIsOneTotalAcrossNamespacesAsync} |
| A transport behind the router that is not Service Bus is left to its own drainer | {verified: AsbNamespacesDeadLetterDrainerTests.ServiceBusTransportsOf_ARouterWithAnotherKindOfTransport_SkipsItAsync} |

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

## Custody and the stored type

A message the broker dead-letters (including one quarantined as poison at the receive boundary)
and a message the transport edge cannot store in the inbox both get custody through the same entry,
`IWorkCoordinator.ImportBrokerDeadLetterAsync`: a `wh_dead_letters` row with `source_table='broker'`
and the raw wire body. The caller hands over the wire's envelope type name
(`MessageEnvelope`1[[<payload>]]`); custody records the **payload** type it wraps, the same form a
received inbox row stores. Recovery re-emits the row into the inbox under that name, so the inbox's
no-consumer gate and its dispatch judge it as the payload it is.

Rows taken into custody before this (whose `message_type` names the envelope) are still recovered:
the no-consumer gates and the inbox drain unwrap an envelope-wrapped name to its payload type.

Before this, every recovered broker dead letter was skipped by the inbox gate as `RegistryChanged`,
because nothing consumes an envelope type.

## Re-entry through the arrival path {#reentry}

Recovery re-enters an inbox or broker dead letter through the inbox's own arrival path. The row is built
exactly as a delivery of the stored envelope is built (event classification, stream, flags, scope,
priority and producer) and stored with `store_inbox_messages`. It differs from a delivery in three ways
only:

- it claims its dead letter (**Recovering**) in the same transaction;
- it is stored even though its message id was already seen (the observation is still counted);
- `wh_inbox_state.recovered_from_dead_letter_id` names the dead letter.

The dead letter reads **Recovering** until the message completes. It becomes **Recovered** once the
message is processed: an event once it is in the event store, a command once its dispatch completes. It
becomes **HoldForReview**, with the outcome in `operator_notes`, when an inbox gate completes it
unprocessed, or when the inbox dead-letters it again (the note names the new dead letter, which now holds
custody). A dead letter whose offloaded body cannot be rebuilt is held for review instead of re-entered.

`recover_dead_letter` handles only outbox and perspective rows.

Before this, recovery wrote the inbox row itself with `is_event = false` and, for a broker import without
a session, no stream. The inbox copy into the event store skipped the row, so a recovered event was
dispatched and deleted without being appended, while its dead letter already read Recovered.

### Re-entering events lost before the fix {#repair}

Events recovered by an older version are not restored automatically. After deploying the fix, reset
their dead letters so the recovery worker re-enters them. Restrict the reset to event types: a recovered
command has already run its handler.

```sql
UPDATE <schema>.wh_dead_letters dl
SET recovery_status = 0, recovered_at = NULL, recovery_attempts = 0, next_recovery_at = NOW(),
    operator_notes = COALESCE(operator_notes || E'\n', '') || 'reset for re-entry'
WHERE dl.source_table IN ('broker', 'wh_inbox')
  AND dl.recovery_status = 3
  AND dl.operator_disposition NOT IN (2, 3)
  AND COALESCE(dl.operator_notes, '') NOT LIKE '%auto-discarded%'
  AND NOT EXISTS (SELECT 1 FROM <schema>.wh_event_store es WHERE es.event_id = dl.source_id)
  AND NOT EXISTS (SELECT 1 FROM <schema>.wh_inbox i WHERE i.message_id = dl.source_id)
  AND <schema>.normalize_event_type(dl.message_type) IN (
    SELECT normalized_message_type FROM <schema>.wh_message_associations
    WHERE association_type = 'perspective');
```

A re-entered event is appended after its stream's current tail, and the perspective cursor is rewound so
perspectives re-apply in event-id order.

## Failure handling

Both implementations are best-effort:

- ASB: if `SendMessageAsync` or `CompleteMessageAsync` throws, the
  message is `AbandonMessageAsync`-ed back to DLQ for the next sweep.
- RMQ: if `BasicPublishAsync` or `BasicAckAsync` throws, the message is
  `BasicNackAsync`-ed with `requeue: true` so it stays in DLQ.

A single drainer failing doesn't stop the others — the worker continues
through the remaining drainers on the current tick.

The transport consumer uses the same custody entry for a message it receives but
cannot store as an inbox row (a payload with no JSON metadata in the service, an
offloaded body that cannot be rebuilt): it records the message with its body instead
of letting the broker settle it. See
[messages that cannot be stored](../../messaging/transports/transport-consumer#unstorable-messages).

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
