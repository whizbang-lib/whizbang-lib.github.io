---
title: Transport Consumer
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Core Concepts
description: >-
  Configure transport message consumption with auto-generated subscriptions,
  subscription resilience, and connection recovery support
tags: 'transport, consumer, subscriptions, resilience, messaging'
codeReferences:
  - src/Whizbang.Core/Workers/TransportConsumerBuilderExtensions.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
  - src/Whizbang.Core/Workers/TransportBatchCollector.cs
  - src/Whizbang.Core/Workers/TransportBatchOptions.cs
  - src/Whizbang.Core/Resilience/SubscriptionResilienceOptions.cs
  - src/Whizbang.Core/Resilience/SubscriptionState.cs
  - src/Whizbang.Core/Resilience/SubscriptionStatusChangedEventArgs.cs
  - src/Whizbang.Core/Resilience/SubscriptionRetryHelper.cs
  - src/Whizbang.Core/Transports/ITransportWithRecovery.cs
  - src/Whizbang.Core/Messaging/InboxReceiveDiscard.cs
  - src/Whizbang.Core/Transports/ReceivedEnvelopeReader.cs
  - src/Whizbang.Data.Postgres/Migrations/242_SkippedArrivalsAreStoredSettled.sql
  - src/Whizbang.Core/Workers/ReceiveConsumerGate.cs
  - src/Whizbang.Core/Workers/ServiceBusConsumerWorker.cs
  - src/Whizbang.Core/Routing/MessageDiscardPolicy.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/TransportConsumerBuilderExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Workers/TransportConsumerBuilderExtensionsServiceNameTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportConsumerWorkerResilienceTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportConsumerWorkerSubscriptionStatusChangedTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportConsumerWorkerConnectionRecoveryTests.cs
  - tests/Whizbang.Core.Component.Tests/Resilience/SubscriptionRetryHelperTests.cs
  - tests/Whizbang.Core.Component.Tests/Resilience/SubscriptionRetryHelperDisconnectWindowTests.cs
  - tests/Whizbang.Core.Component.Tests/Resilience/SubscriptionRetryHelperReconnectBackoffTests.cs
  - tests/Whizbang.Core.Tests/HealthChecks/SubscriptionHealthCheckTests.cs
  - tests/Whizbang.Core.Tests/Observability/ServiceInstanceProviderTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportBatchCollectorTests.cs
  - tests/Whizbang.Core.Component.Tests/Shutdown/BatcherShutdownTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportConsumerWorkerBodyOffloadTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportConsumerWorkerStoresBeforeSkippingTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InboxDiscardedOnReceiveSqlTests.cs
  - tests/Whizbang.Core.Tests/Transports/ReceivedEnvelopeReaderTests.cs
  - tests/Whizbang.Core.Tests/Workers/ReceiveConsumerGateTests.cs
  - tests/Whizbang.Core.Tests/Routing/MessageDiscardPolicyTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/ServiceBusConsumerWorkerDropGateTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AbsorbedEventReachesEventStoreTests.cs
lastMaintainedCommit: '01f07906'
---

# Transport Consumer

The transport consumer automatically subscribes to message broker destinations and processes incoming messages. When combined with `WithRouting()`, subscriptions are auto-generated from your routing configuration.

## Overview

The `AddTransportConsumer()` extension method:

1. **Auto-generates subscriptions** from `RoutingOptions` configured via `WithRouting()`
2. **Registers `TransportConsumerOptions`** with populated destinations
3. **Starts `TransportConsumerWorker`** as a hosted service

## Auto-Configuration {#auto-configuration}

The recommended approach chains `WithRouting()` and `AddTransportConsumer()`:

```csharp{title="Auto-Configuration" description="The recommended approach chains WithRouting() and AddTransportConsumer():" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Auto-Configuration", "Auto-configuration"] tests=["TransportConsumerBuilderExtensionsTests.AddTransportConsumer_AutoPopulatesInboxDestination_FromOwnDomainsAsync", "TransportConsumerBuilderExtensionsTests.AddTransportConsumer_AutoPopulatesEventDestinations_FromSubscribeToAsync"]}
services.AddWhizbang()
    .WithRouting(routing => {
        routing
            .OwnDomains("myapp.orders.commands")
            .SubscribeTo("myapp.payments.events")
            .Inbox.UseSharedTopic("inbox");
    })
    .WithEFCore<OrderDbContext>()
    .WithDriver.Postgres
    .AddTransportConsumer();
```

This auto-generates subscriptions:
- **Inbox subscription** from `OwnDomains()` - Filters commands by namespace pattern
- **Event subscriptions** from `SubscribeTo()` - Subscribes to each namespace topic
- **Auto-discovered events** from perspectives and receptors

### What Gets Generated

For the configuration above, `AddTransportConsumer()` generates:

| Destination | Address | Routing Key |
|-------------|---------|-------------|
| Inbox | `inbox` | `myapp.orders.commands.#` |
| Payment Events | `myapp.payments.events` | `#` |

If your service has perspectives or receptors that handle events from other namespaces, those are automatically discovered and added.

## Additional Destinations {#additional-destinations}

Add custom destinations beyond auto-generated ones:

```csharp{title="Additional Destinations" description="Add custom destinations beyond auto-generated ones:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Additional", "Destinations"] tests=["TransportConsumerBuilderExtensionsTests.AddTransportConsumer_WithAdditionalDestinations_IncludesThemAsync", "TransportConsumerBuilderExtensionsTests.AddTransportConsumer_WithMultipleAdditionalDestinations_IncludesAllAsync"]}
services.AddWhizbang()
    .WithRouting(routing => {
        routing.OwnDomains("myapp.orders.commands");
    })
    .AddTransportConsumer(config => {
        // Add custom destination (address + routing key)
        config.AdditionalDestinations.Add(
            new TransportDestination("custom-topic", "custom.events.#"));

        // Add multiple custom destinations
        config.AdditionalDestinations.Add(
            new TransportDestination("audit-events", "#"));
    });
```

Additional destinations are appended after auto-generated ones.

## Complete Worker Setup

A typical worker service includes transport registration, routing, and consumer:

```csharp{title="Complete Worker Setup" description="A typical worker service includes transport registration, routing, and consumer:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Complete", "Worker"] unverified="end-to-end host composition (real transport registration + host.Run()); the AddTransportConsumer auto-configuration it relies on is verified on the Auto-Configuration example"}
var builder = Host.CreateApplicationBuilder(args);

// 1. Register transport (Azure Service Bus or RabbitMQ)
var serviceBusConnection = builder.Configuration.GetConnectionString("servicebus")
    ?? throw new InvalidOperationException("Connection string not found");
builder.Services.AddAzureServiceBusTransport(serviceBusConnection);

// 2. Configure Whizbang with routing and consumer
builder.Services.AddWhizbang()
    .WithRouting(routing => {
        routing
            .OwnDomains("myapp.orders.commands")
            .SubscribeTo("myapp.payments.events", "myapp.users.events")
            .Inbox.UseSharedTopic("inbox");
    })
    .WithEFCore<OrderDbContext>()
    .WithDriver.Postgres
    .AddTransportConsumer();

// 3. Register generated services
builder.Services.AddReceptors();
builder.Services.AddWhizbangDispatcher();

var host = builder.Build();
host.Run();
```

## Transport Independence

The consumer configuration is transport-agnostic. The same `WithRouting()` and `AddTransportConsumer()` calls work with:

- **Azure Service Bus** - Creates topics and subscriptions
- **RabbitMQ** - Creates exchanges and queues
- **In-Memory** (testing) - Direct message routing

Transport-specific behavior is handled by the transport implementation registered separately.

## Batch Collector {#batch-collector}

Transports deliver received messages to the consumer in batches. A transport's batch subscription buffers each message it receives in a `TransportBatchCollector<T>` and hands the collected batch to the consumer's handler when the first of three triggers fires, configured by `TransportBatchOptions`:

| Trigger | Option | Default | Flushes |
|---|---|---|---|
| Batch size | `BatchSize` | 200 | At once, when that many messages are buffered |
| Sliding window | `SlideMs` | 20 | A partial batch, once no message has arrived for that long |
| Hard maximum | `MaxWaitMs` | 1000 | Whatever is buffered, that long after the first message of the batch, even while messages keep arriving |

{verified: TransportBatchCollectorTests.Enqueue_FlushesImmediatelyWhenBatchSizeReachedAsync, TransportBatchCollectorTests.Enqueue_FlushesOnSlidingWindowTimeoutAsync, TransportBatchCollectorTests.Enqueue_SlidingWindowResetsOnNewMessageAsync, TransportBatchCollectorTests.Enqueue_FlushesOnHardMaxTimeoutAsync}

`Enqueue` never blocks: the flushes run in the background, and `OnBatchFlushed` reports the size of each batch handed over. Disposing the collector stops its timers, waits for the flushes still running, and then flushes what is left, so no batch is handed to the handler after disposal returns ([#1721](https://github.com/whizbang-lib/whizbang/issues/1721)).
{verified: TransportBatchCollectorTests.DisposeAsync_FlushesRemainingMessagesAsync, BatcherShutdownTests.ATransportBatchCollectorFlush_InFlight_DisposalWaitsForItAsync}

The `TransportConsumerWorker` also waits, in its `StopAsync`, for the [active body cleanups](../../fundamentals/offloads/message-body-store.md#active-cleanup) it started in the background, so they finish before the host disposes the service provider. See [Detached Work When the Host Stops](../../fundamentals/lifecycle/lifecycle-stages.md#host-stop).
{verified: TransportConsumerWorkerBodyOffloadTests.BatchHandler_ActiveCleanupInFlight_WorkerStopWaitsForItBeforeTheContainerIsDisposedAsync}

## Error Handling

When `WithRouting()` is not called before `AddTransportConsumer()`:

```csharp{title="Error Handling" description="When WithRouting() is not called before AddTransportConsumer():" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Error", "Handling"] tests=["TransportConsumerBuilderExtensionsTests.AddTransportConsumer_WithoutRouting_ThrowsInvalidOperationExceptionAsync"]}
// This throws InvalidOperationException at runtime
services.AddWhizbang()
    .AddTransportConsumer();  // Error: WithRouting() must be called first
```

The error occurs when resolving `TransportConsumerOptions` from the service provider, not at registration time.

## Stored before settling {#batch-handler}

Every received message whose body is a valid envelope is stored in the inbox before the broker is told
anything. The transport hands each one to the consumer's batch handler, which stores it with
`store_inbox_messages`; only when the handler returns does Azure Service Bus complete the message or
RabbitMQ ack it. Nothing is acked and dropped on the way in.

A message the transport cannot read as its typed envelope is still a valid envelope: a type no JSON
context in this service describes, a body the typed read rejects, or a valid envelope with no
`EnvelopeType` property or header. The transport reads it as received (`ReceivedEnvelopeReader`, an
envelope of `JsonElement` under the type the producer named) and hands it on to be stored like any other.
An opt-in raw receptor for the type runs once the message is stored.

```mermaid{caption="Receive path: a valid envelope is stored before the broker is settled, a skip is stored settled with its reason, and only a body that is not an envelope goes to the broker's dead-letter queue." tests=["TransportConsumerWorkerStoresBeforeSkippingTests.AMessageNoLocalConsumerTakes_IsStoredAsync", "AsbReceiveStoresBeforeSettlingTests.Decide_ABodyThatIsNotAnEnvelope_IsDeadLetteredAsync"]}
flowchart TD
    R["Message received<br/>(Service Bus, RabbitMQ)"] --> E{"Body is a<br/>readable envelope?"}
    E -->|"no"| D["Dead-lettered at the broker<br/>(the drain gives it custody)"]
    E -->|"yes, typed or as received"| C{"Consumer processes it?"}
    C -->|"yes"| S["Stored as new work"]
    C -->|"no: skip reason"| K["Stored settled<br/>(DiscardedOnReceive)"]
    S --> A["Broker settled<br/>(complete / ack)"]
    K --> A

    class R,C layer-command
    class S,K layer-event
    class E,A layer-core
    class D layer-observability
```

### Skipped messages are stored settled {#skipped-messages}

The consumer still decides not to process some messages. It no longer drops them before the store: it
stores them already settled, with the reason in `InboxMessage.DiscardedOnReceive` (one of the
`InboxReceiveDiscard` constants):

| Reason | When |
|---|---|
| `no_local_consumer` | No receptor, lifecycle receptor, perspective or runtime receptor on this service consumes the message's type. Offloaded bodies and composites are exempt, since their consumers are known only after rehydration or fan-out. Events in an [absorbed namespace](../../fundamentals/dispatcher/routing#absorbed-namespaces) are exempt too, since they are kept for the event store with no consumer (see [below](#absorbed-events-on-receive)). |
| `foreign_target` | The envelope is directed at another service (its target names a different service). |
| `owned_echo` | An event of a namespace this service owns, delivered back to it: its own event, already stored here (see [echo suppression](../../fundamentals/dispatcher/routing#transport-echo-suppression)). |
| `self_echo` | A command of a namespace this service owns whose last hop is this service: its own send, delivered back. |
| `unknown_event_type` | An event whose type was not among the event types this service knew when it started receiving. |

`store_inbox_messages` stores a skipped message like every arrival (deduplication is counted and both rows
are written) but settled: processed at arrival, with status Stored and Published, and
`discarded on receive: <reason>` in `wh_inbox_state.error` (migration 242). A settled row is never
claimed, copied into the event store or dispatched, so it rings no doorbell, pins no stream and is never
returned as new work. It stays readable until maintenance purges completed inbox rows, or, in debug mode,
until an operator removes it. Each skip is counted by `whizbang.transport.inbox.messages_discarded`,
tagged `reason` and `message_type` (see [metrics](../../operations/observability/metrics#transport)).

Expect more inbox rows than before: a service that receives many messages it does not consume now keeps a
settled row for each until the next purge.

The non-durable receive of the control class is unchanged: those messages are still handled without an
inbox row.

#### Absorbed events are stored live {#absorbed-events-on-receive}

The `no_local_consumer` skip does not apply to an event in an
[absorbed namespace](../../fundamentals/dispatcher/routing#absorbed-namespaces). Such an event is stored as
an ordinary inbox row even when nothing on this service consumes it, so the claim copies it into the event
store and a perspective added later can rebuild from it. Nothing here takes it at dispatch, so the dispatch
gate settles the row on its first claim: no handler runs, nothing is retried and nothing is dead-lettered.
An unconsumed event in a namespace that is not absorbed is still stored settled as `no_local_consumer`.

The transport consumer and the Service Bus consumer make this decision through one shared gate, so the two
cannot drift apart. The gate asks the receptor registries first (compile-time consumers, runtime receptors
and composites); when they find no consumer, it asks the registered message-discard policy, which owns the
absorbed-namespace match. A host that registers no discard policy keeps the registry-only decision.

At dispatch, the inbox gate logs the skip of an absorbed event as `NoLocalConsumer` at Debug, since it is
the expected steady state of an absorbed namespace. `RegistryChanged` at Information now means only a row
outside the absorbed namespaces that reached dispatch with no consumer registered: its consumer
disappeared after it was stored, typically because a deploy removed a receptor.
{verified: ReceiveConsumerGateTests.NoConsumer_InAnAbsorbedNamespace_KeepsTheMessageAsync, ReceiveConsumerGateTests.NoConsumer_OutsideTheAbsorbedNamespaces_IsUnconsumedAsync, ReceiveConsumerGateTests.NoConsumer_AndNoPolicy_IsUnconsumedAsync, ReceiveConsumerGateTests.BodyOffloadClaim_KeepsTheMessageAsync, ReceiveConsumerGateTests.Composite_KeepsTheMessageAsync, TransportConsumerWorkerStoresBeforeSkippingTests.AnUnconsumedEventInAnAbsorbedNamespace_IsStoredLive_SoTheEventStoreCapturesItAsync, TransportConsumerWorkerStoresBeforeSkippingTests.AnUnconsumedEventOutsideTheAbsorbedNamespaces_IsStillStoredSettledAsync, TransportConsumerWorkerStoresBeforeSkippingTests.AnAbsorbedEventWithALocalConsumer_IsStoredLiveAsBeforeAsync, ServiceBusConsumerWorkerDropGateTests.HandleMessage_UnconsumedEventInAnAbsorbedNamespace_IsStoredLive_SoTheEventStoreCapturesItAsync, ServiceBusConsumerWorkerDropGateTests.HandleMessage_UnconsumedEventOutsideTheAbsorbedNamespaces_IsStillStoredSettledAsync, MessageDiscardPolicyTests.EvaluateInbox_UnconsumedType_OnAbsorbedNamespace_IsSkippedAsRoutine_NotAsRegistryDriftAsync, MessageDiscardPolicyTests.EvaluateInbox_UnconsumedType_OnNonAbsorbedNamespace_IsStillRegistryDriftAsync, AbsorbedEventReachesEventStoreTests.AnUnconsumedEventInAnAbsorbedNamespace_IsCopiedIntoTheEventStoreAsync, AbsorbedEventReachesEventStoreTests.AnUnconsumedEventOutsideTheAbsorbedNamespaces_IsNotCopiedAsync}
{verified: TransportConsumerWorkerStoresBeforeSkippingTests.AMessageNoLocalConsumerTakes_IsStoredAsync, TransportConsumerWorkerStoresBeforeSkippingTests.AMessageDirectedAtAnotherService_IsStoredAsync, TransportConsumerWorkerStoresBeforeSkippingTests.AnEchoOfThisServicesOwnEvent_IsHeldNotDroppedAsync, TransportConsumerWorkerStoresBeforeSkippingTests.AnEchoOfThisServicesOwnCommand_IsStoredAsync, TransportConsumerWorkerStoresBeforeSkippingTests.AnEventTheKnownEventFilterRejects_IsStoredAsync, TransportConsumerWorkerStoresBeforeSkippingTests.AnUnconsumedEventTheKnownEventFilterAlsoRejects_KeepsItsFirstReasonAsync, TransportConsumerWorkerStoresBeforeSkippingTests.AMessageThisServiceProcesses_IsStoredWithNoReasonAsync, TransportConsumerWorkerStoresBeforeSkippingTests.ASkip_IsCountedUnderItsReason_NotAsADuplicateAsync, InboxDiscardedOnReceiveSqlTests.AMessageDiscardedOnReceive_IsStoredSettled_WithItsReason_AndNeverClaimedOrCopiedAsync}

### The one refusal {#refused-bodies}

Only a body that is not a readable envelope is refused before storage: there is nothing to store it as.
Both transports dead-letter it at the broker, where the
[transport dead-letter drain](../../operations/dead-letter-queue/transport-recovery) gives it custody. An
envelope whose message id is not a UUIDv7 is refused the same way. On RabbitMQ this also ends a hot loop: a
body the deserializer threw on used to escape the batch flush, and the batch collector flushed that batch
again on every window without ever acking or nacking it. The body is now dead-lettered and its neighbors
are stored and acked.
{verified: ReceivedEnvelopeReaderTests.TryRead_AValidEnvelope_ReturnsItAsReceivedAsync, ReceivedEnvelopeReaderTests.TryRead_ABodyThatIsNotAnEnvelope_ReturnsNullAsync, ReceivedEnvelopeReaderTests.TryRead_AnEnvelopeWhoseIdIsNotAMessageId_ReturnsNullAsync, AsbReceiveStoresBeforeSettlingTests.Decide_AValidEnvelopeOfATypeThisServiceDoesNotKnow_IsHandedOnAsReceivedAsync, AsbReceiveStoresBeforeSettlingTests.Decide_AValidEnvelopeTheTypedReadRejects_IsHandedOnAsReceivedAsync, AsbReceiveStoresBeforeSettlingTests.Decide_AnEnvelopeNoLocalConsumerTakes_IsHandedOnToBeStoredAsync, AsbReceiveStoresBeforeSettlingTests.Decide_AnEnvelopeARawReceptorTakes_IsHandedOnToBeStored_WithTheReceptorAsync, AsbReceiveStoresBeforeSettlingTests.Decide_AValidEnvelopeWithNoEnvelopeTypeProperty_IsHandedOnAsReceivedAsync, AsbReceiveStoresBeforeSettlingTests.Decide_AnEnvelopeWhoseIdIsNotAMessageId_IsDeadLetteredAsync, AsbReceiveStoresBeforeSettlingTests.Decide_ABodyThatIsNotAnEnvelope_IsDeadLetteredAsync, RabbitMQReceiveStoresBeforeSettlingTests.Flush_ABodyTheDeserializerThrowsOn_IsDeadLettered_AndItsNeighborsAreStoredAndAckedAsync, RabbitMQReceiveStoresBeforeSettlingTests.Flush_AnEnvelopeOfATypeThisServiceDoesNotKnow_IsHandedOnToBeStoredBeforeItIsAckedAsync, RabbitMQReceiveStoresBeforeSettlingTests.Deliver_AMessageNoLocalConsumerTakes_IsHandedOnToBeStoredBeforeItIsAckedAsync, RabbitMQReceiveStoresBeforeSettlingTests.Deliver_AnEnvelopeOfATypeThisServiceDoesNotKnow_IsHandedOnToBeStoredAsync, RabbitMQReceiveStoresBeforeSettlingTests.Flush_AValidEnvelopeWithNoEnvelopeTypeHeader_IsHandedOnWithNoTypeAsync, RabbitMQReceiveStoresBeforeSettlingTests.Deliver_AValidEnvelopeWithNoEnvelopeTypeHeader_IsHandedOnWithNoTypeAsync, RabbitMQReceiveStoresBeforeSettlingTests.Flush_AnEnvelopeWhoseIdIsNotAMessageId_IsDeadLettered_AndTheFlushCompletesAsync, RabbitMQReceiveStoresBeforeSettlingTests.Deliver_ABodyTheDeserializerThrowsOn_IsDeadLetteredNotLoopedAsync}

## Messages that cannot be stored {#unstorable-messages}

Every received message becomes an inbox row before anything else happens to it. When
a message cannot become one, the consumer never skips it and lets the broker settle
it as consumed. It gives the message dead-letter custody in `wh_dead_letters` through
`IWorkCoordinator.ImportBrokerDeadLetterAsync`, the same entry the
[broker dead-letter drain](../../operations/dead-letter-queue/transport-recovery)
uses, and the rest of the batch is stored as usual:

| Cause | Reason recorded | Body kept |
|---|---|---|
| The envelope cannot be serialized for the inbox (no JSON metadata for its payload in this service's options) | `SerializationError`, with the underlying exception | The envelope re-serialized against every context registered at that moment; if even that fails, a descriptor naming the message id, envelope type and failure |
| A valid envelope that names no envelope type (no `EnvelopeType` property or header), so no row can be typed | `SerializationError`, with the underlying exception | The envelope |
| An offloaded body downloads but cannot be read as its envelope type | `SerializationError` | The downloaded original body, verbatim |
| An offloaded body cannot be obtained (unknown provider, integrity failure, unknown cipher) | The rehydrate reason, e.g. `BodyClaimProviderUnknown` | The claim envelope, which still locates the body in its store |

The record lands with `source_table = 'broker'`, the wire message id as its
idempotency key, the subscription (`topic/subscription`) as its destination, and the
reason in its error text. Dead-letter recovery re-emits it through the inbox once the
consumer is fixed. Each one is logged at Error level and counted in
`whizbang.transport.inbox.messages_failed`.

If custody itself cannot be given (the coordinator refuses the import), the message
is logged at Critical level and the batch fails after every other message in the batch
is stored (see [failed batches](#failed-batches)). A failed download of an
offloaded body is still thrown for redelivery, since the body is usually there on a
later attempt.
{verified: TransportConsumerWorkerUnstorableMessageTests.SerializationFails_MessageDeadLetteredWithBody_NeighborsStillStoredAsync, TransportConsumerWorkerUnstorableMessageTests.SerializationFails_PayloadNoContextKnows_DeadLetteredWithDescriptorAsync, TransportConsumerWorkerUnstorableMessageTests.OffloadedBodyUnreadable_DeadLetteredWithDownloadedBodyAsync, TransportConsumerWorkerUnstorableMessageTests.OffloadedBodyProviderUnknown_DeadLetteredWithClaimAsync, TransportConsumerWorkerUnstorableMessageTests.CustodyUnavailable_BatchFailsAfterStoringNeighborsAsync}

### Messages that cannot be read back {#unreadable-messages}

The framework reads and writes a consumer's stored messages with the host's
registered `JsonSerializerOptions`, completed by the registry: every registered
context answers first, the host's resolver and converters answer behind them,
and out-of-order metadata is allowed because `jsonb` reorders keys. A host that
registers a narrower chain, such as its generated `WhizbangJsonContext.CreateOptions()`,
still stores and reads what the transport can.
{verified: JsonContextRegistryCompleteChainTests.WithCompleteChain_HostOptions_ResolvesRegisteredTypesTheHostCannotAsync}

- An inbox row whose payload the serializer refuses at dispatch is dead-lettered
  with its body (`SerializationError`) and never completed. Without a dead-letter
  store, the failure is recorded on the row and the attempts bound governs it.
  {verified: InboxDispatchWorkerUndeserializablePayloadTests.Dispatch_PayloadRefusedBySerializer_DeadLettersWithBody_AndNeverCompletesAsync, InboxDispatchWorkerUndeserializablePayloadTests.LifecycleStages_PayloadRefused_NoStageRuns_AndNoCompletionIsEnqueuedAsync}

## Failed batches {#failed-batches}

A batch can fail as a whole: the inbox store times out, or a message can be neither
stored nor dead-lettered. The worker logs the failure at Error level (naming SQLSTATE
57014 when the database canceled the statement) and reports it to the transport as a
`TransportBatchFailedException`. It never swallows the failure, because every transport
settles a message by whether its handler returned: a swallowed failure is completed and
lost. The signal is never a cancellation, so a statement timeout cannot be mistaken for a
shutdown, and the worker keeps running.

| Transport | What a failed batch gets |
|---|---|
| Azure Service Bus, sessions | Each message is abandoned; at `MaxDeliveryAttempts` it is dead-lettered at the broker |
| Azure Service Bus, no sessions | Each message in the batch is abandoned; at `MaxDeliveryAttempts` it is dead-lettered at the broker |
| RabbitMQ | Each message is NACKed with requeue |
| In-process | The batch is re-queued in memory and retried |

On Azure Service Bus a message that keeps failing therefore ends in the broker's
dead-letter queue, from which the
[transport dead-letter drain](../../operations/dead-letter-queue/transport-recovery)
gives it durable custody. RabbitMQ has no delivery count of its own for a requeued
message: give the queue a delivery limit (a quorum queue with `x-delivery-limit` and a
dead-letter exchange), or a batch that always fails is redelivered indefinitely. A real host shutdown propagates as itself and is never wrapped.
{verified: TransportBatchGuardTests.AStatementTimeoutFailsTheBatchAsATypedSignalNotACancellationAsync, TransportConsumerWorkerBatchFailureTests.InboxStoreTimesOut_TransportToldBatchFailed_WorkerStaysUpAndStoresTheRedeliveryAsync, AzureServiceBusTransportBatchPipelineTests.NonSessionBatch_HandlerReportsBatchFailed_AbandonsNeverCompletesAsync, AzureServiceBusTransportBatchPipelineTests.NonSessionBatch_HandlerFailsAtMaxDeliveryCount_DeadLettersNeverCompletesAsync, AzureServiceBusTransportBatchPipelineTests.SessionBatch_HandlerReportsBatchFailedFromACancellation_AbandonsNeverCompletesAsync, RabbitMQTransportBatchPathTests.SubscribeBatchAsync_HandlerReportsBatchFailedFromACancellation_NacksNeverAcksAsync}

## Subscription Resilience {#subscription-resilience}

:::new
Added in v1.0.0
:::

By default, the transport consumer includes built-in resilience for subscription failures. Subscriptions retry **forever** until success or cancellation - critical for production systems where transient broker issues should not cause permanent failures.

### Core Types

**SubscriptionResilienceOptions**:
Configuration options for subscription retry behavior. Controls exponential backoff, retry limits, and partial subscription handling.

**SubscriptionStatus**:
Enumeration tracking subscription states:
- `Pending` - Waiting to subscribe
- `Recovering` - Retrying after failure
- `Healthy` - Successfully subscribed
- `Failed` - Failed (when `RetryIndefinitely = false`)

**SubscriptionState**:
Tracks the current state of each subscription, including destination, status, error messages, and retry count.

**SubscriptionRetryHelper**:
Internal helper class that implements exponential backoff logic and retry coordination.

### Retry Behavior

The retry system uses **exponential backoff**:

| Property | Default | Description |
|----------|---------|-------------|
| `InitialRetryDelay` | 1 second | Starting delay between retries |
| `MaxRetryDelay` | 120 seconds | Cap on exponential backoff |
| `BackoffMultiplier` | 2.0 | Delay multiplier per attempt |
| `InitialRetryAttempts` | 5 | Attempts before reducing log verbosity |
| `RetryIndefinitely` | true | Never give up (recommended) |
| `HealthCheckInterval` | 1 minute | Interval for health check sweeps |
| `ReconnectBackoffResetAfter` | 30 seconds | How long a subscription must stay healthy before its next disconnect reconnects after `InitialRetryDelay` again; `TimeSpan.Zero` treats every disconnect as the first |
| `AllowPartialSubscriptions` | true | Start with partial subscriptions |

**How Exponential Backoff Works**:

```
Attempt 1: 1 second delay
Attempt 2: 2 seconds delay (1 * 2.0)
Attempt 3: 4 seconds delay (2 * 2.0)
Attempt 4: 8 seconds delay (4 * 2.0)
Attempt 5: 16 seconds delay (8 * 2.0)
Attempt 6: 32 seconds delay (16 * 2.0)
Attempt 7: 64 seconds delay (32 * 2.0)
Attempt 8: 120 seconds delay (64 * 2.0, capped at MaxRetryDelay)
Attempt 9+: 120 seconds delay (continues at max)
```

#### Reconnecting after a disconnect {#reconnect-backoff}

The same backoff carries across disconnects of one destination. A subscription that disconnects before it has stayed
healthy for `ReconnectBackoffResetAfter` waits the previous reconnect's delay times `BackoffMultiplier`, up to
`MaxRetryDelay`, so a destination that fails right after every subscribe (a broker entity that stays disabled, an
identity without access) reconnects after 1, 2, 4 ... 120 seconds instead of every second. A subscription that stayed
healthy that long reconnects after `InitialRetryDelay`, so an ordinary one-off drop is as quick as before. Connection
recovery and the health-monitor sweep do not reset the streak; the next disconnect is judged by how long the new
subscription stayed healthy. The disconnect warning states the wait.

```csharp{title="Reconnect backoff across disconnects" description="Tune how quickly a repeatedly failing destination is retried and when it counts as recovered" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Resilience"] tests=["SubscriptionRetryHelperReconnectBackoffTests.SubscribeWithRetryAsync_DestinationDropsRightAfterEverySubscribe_EachReconnectWaitsLongerUpToTheCapAsync", "SubscriptionRetryHelperReconnectBackoffTests.SubscribeWithRetryAsync_SubscriptionStaysHealthyForTheResetPeriod_NextReconnectWaitsTheInitialDelayAgainAsync", "SubscriptionRetryHelperReconnectBackoffTests.SubscribeWithRetryAsync_ResetPeriodIsZero_EveryReconnectWaitsTheInitialDelayAsync"]}
services.AddWhizbang()
    .AddTransportConsumer(config => {
        // A subscription that stays up for two minutes counts as recovered.
        config.ResilienceOptions.ReconnectBackoffResetAfter = TimeSpan.FromMinutes(2);
    });
```

The retry and reconnect waits run on the worker's `TimeProvider`: `TransportConsumerWorker` takes an optional
`TimeProvider` (from DI when the host registers one, otherwise the system clock), and
`SubscriptionRetryHelper.SubscribeWithRetryAsync` has an overload that takes one, so tests can drive them with a fake
clock.

### Configuration

Customize resilience behavior through `TransportConsumerConfiguration`:

```csharp{title="Configuration" description="Customize resilience behavior through TransportConsumerConfiguration:" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Configuration"] unverified="resilience options assignment; retry/backoff semantics are verified in SubscriptionRetryHelperTests (see Retry Behavior)"}
services.AddWhizbang()
    .WithRouting(routing => {
        routing.OwnDomains("myapp.orders.commands");
    })
    .AddTransportConsumer(config => {
        // Customize retry behavior
        config.ResilienceOptions.InitialRetryDelay = TimeSpan.FromSeconds(2);
        config.ResilienceOptions.MaxRetryDelay = TimeSpan.FromMinutes(5);
        config.ResilienceOptions.BackoffMultiplier = 1.5;

        // Allow partial failures (some subscriptions can fail)
        config.ResilienceOptions.AllowPartialSubscriptions = true;

        // Custom health check interval
        config.ResilienceOptions.HealthCheckInterval = TimeSpan.FromSeconds(30);
    });
```

### Health Monitoring

When resilience is enabled, a health check is automatically registered:

```csharp{title="Health Monitoring" description="When resilience is enabled, a health check is automatically registered:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Health", "Monitoring"] unverified="ASP.NET Core health-check endpoint mapping; subscription health logic is verified in SubscriptionHealthCheckTests"}
app.MapHealthChecks("/health");  // Includes subscription health
```

Health check results:
- **Healthy**: All subscriptions healthy
- **Degraded**: Mixed status (some subscriptions recovering, pending, or failed)
- **Unhealthy**: All subscriptions failed

The health check includes diagnostic data:
- `failed_destinations`: List of failed subscription addresses
- `recovering_destinations`: List of subscriptions currently retrying

### Connection Recovery

For transports that support connection recovery (RabbitMQ, Azure Service Bus), subscriptions are automatically re-established after connection loss:

1. Transport detects connection recovery
2. Worker receives recovery notification via `ITransportWithRecovery`
3. All subscriptions are reset to pending
4. Retry loop re-establishes each subscription

This ensures subscriptions survive both initial failures and runtime connection issues.

### Subscription status changes {#subscription-status-changes}

`TransportConsumerWorker.SubscriptionStatusChanged` reports every change in a destination's subscription status, one
event per change, with the destination, the previous status and the new one:

- `Pending` to `Healthy` when a subscription is established.
- To `Recovering` on a failed attempt or a disconnect, and to `Failed` when the initial retries run out.
- Back to `Pending` when the health monitor or a connection recovery retries the subscription.

The event is raised synchronously on the thread that changed the status, after the last error, the attempt count
and the subscription are recorded, so a handler that reads `State` sees them already set. Writing the status a
destination already has raises nothing. A handler that throws is logged as a warning naming the destination and
status; neither the subscription nor the other handlers are affected. Keep handlers short, because they run on the
subscription path. With no handler attached, a change costs one null check.

```csharp{title="Alert on subscription status changes" description="Log every destination whose subscription changes status" category="Operations" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Health", "Monitoring"] tests=["TransportConsumerWorkerSubscriptionStatusChangedTests.SubscriptionStatusChanged_EveryDestinationSubscribes_RaisedPendingToHealthyAfterTheStateIsRecordedAsync", "TransportConsumerWorkerSubscriptionStatusChangedTests.SubscriptionStatusChanged_SubscribeKeepsFailing_RaisedRecoveringThenFailedWithTheErrorRecordedAsync"]}
var worker = app.Services.GetRequiredService<TransportConsumerWorker>();
worker.SubscriptionStatusChanged += (_, e) =>
  logger.LogWarning("Subscription {Destination}: {Previous} -> {Status}",
    e.Destination.Address, e.PreviousStatus, e.Status);
```

A subscription that disconnects while it is still being established is not lost. The consumer attaches its
disconnect handler before it records `Healthy` and then reads the subscription's recorded
[disconnect](transports.md#subscription-disconnects), so a drop at any point after the transport created the
subscription is reported as `Healthy` followed at once by `Recovering`, and a reconnect follows. Only the first
disconnect of a subscription starts a reconnect, and a disconnect from a subscription that a later one has replaced
changes nothing.

The reconnect releases the subscription that disconnected before it subscribes again: it detaches the disconnect
handler, takes the subscription out of the destination's state and disposes it, so a destination that drops
repeatedly does not leave a channel or processor behind for each drop. A dispose that throws is logged as a warning
naming the destination, and the reconnect still runs. Connection recovery and shutdown take the subscription out of
the state the same way, so whichever of the three gets a subscription disposes it, and none disposes it twice.

`SubscriptionsReady` marks the end of the initial subscription pass, once; this event reports every later change
per destination.

### Observability

Monitor subscription state through:

**Logging**:
- Initial retries (attempts 1 through `InitialRetryAttempts`): Warning level with full details
- Indefinite retries (beyond `InitialRetryAttempts`): logged only every 10th attempt to reduce noise

**Metrics** (if using health checks):
- Total subscriptions count
- Active subscriptions count
- Failed subscriptions count
- Recovering subscriptions count

**Diagnostic Data**:
Access subscription state programmatically through the health check data dictionary.

## Service Name Resolution

The consumer uses service name for subscription naming:

1. **`IServiceInstanceProvider`** - If registered, uses `ServiceName` property
2. **Entry Assembly** - Falls back to assembly name
3. **Default** - Uses "UnknownService" as ultimate fallback

Register a custom provider for explicit control:

```csharp{title="Service Name Resolution" description="Register a custom provider for explicit control:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Service", "Name"] tests=["TransportConsumerBuilderExtensionsTests.AddTransportConsumer_UsesServiceInstanceProviderServiceNameAsync"]}
builder.Services.AddSingleton<IServiceInstanceProvider>(
    new ServiceInstanceProvider(
        instanceId: TrackedGuid.New(),
        serviceName: "MyOrderService",
        hostName: Environment.MachineName,
        processId: Environment.ProcessId));
```

Alternatively, set the `Whizbang:ServiceName` (or `ServiceName`) configuration key and use the default `ServiceInstanceProvider(IConfiguration?)` constructor, which resolves the name from configuration before falling back to the entry assembly name.

```csharp{title="Service Name via Configuration" description="Resolve service name from configuration:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Service", "Name"] tests=["ServiceInstanceProviderTests.ServiceInstanceProvider_WithConfiguration_ResolvesServiceName_FromWhizbangKeyAsync"]}
builder.Services.AddSingleton<IServiceInstanceProvider>(sp =>
    new ServiceInstanceProvider(sp.GetRequiredService<IConfiguration>()));
```

## Prerequisites

Before calling `AddTransportConsumer()`:

1. **Transport Registration** - Call `AddAzureServiceBusTransport()` or `AddRabbitMQTransport()`
2. **Routing Configuration** - Call `WithRouting()` to configure routing options
3. **Receptors** (optional) - Call `AddReceptors()` for message handlers

## Related Documentation

- [Routing](../../fundamentals/dispatcher/routing.md) - Namespace-based routing configuration
- Inbox/Outbox - Message persistence and delivery guarantees
- Workers - Background processing workers
- [RabbitMQ Transport](./rabbitmq.md) - RabbitMQ transport configuration
- [Azure Service Bus Transport](./azure-service-bus.md) - Azure Service Bus transport configuration
