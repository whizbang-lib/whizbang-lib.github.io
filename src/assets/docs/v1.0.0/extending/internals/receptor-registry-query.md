---
title: Receptor Registry Query
pageType: concept
version: 1.0.0
category: Architecture
order: 8
description: >-
  The source-generated receptor registry: the predicates the receive boundary keeps or
  discards by, the handled-message list routing builds subscriptions from, and the
  consumer registry, the one answer to what a service consumes, read by stream
  integrity, the subscription-expansion backfill, the orphan-inbox janitor and the
  receive path's event classification.
tags: >-
  receptor-registry, consumer-registry, consumed-types, receive-boundary,
  source-generators, stream-integrity, message-catalog, extensibility
codeReferences:
  - src/Whizbang.Core/Messaging/IConsumerRegistry.cs
  - src/Whizbang.Core/Messaging/ConsumedMessageInfo.cs
  - src/Whizbang.Core/Messaging/ConsumedMessageTypes.cs
  - src/Whizbang.Core/Messaging/IReceptorRegistryQuery.cs
  - src/Whizbang.Core/Messaging/HandledMessageInfo.cs
  - src/Whizbang.Core/Messaging/ReceptorRegistryContribution.cs
  - src/Whizbang.Core/Messaging/WhizbangReceptorRegistryQueryAdapter.cs
  - src/Whizbang.Core/Generated/WhizbangReceptorRegistryQuery.cs
  - src/Whizbang.Core/Messaging/CatalogMessageKinds.cs
  - src/Whizbang.Core/Workers/ReceivedInboxMessageBuilder.cs
  - src/Whizbang.Core/Workers/ReceiveConsumerGate.cs
  - src/Whizbang.Generators/ReceptorRegistryQueryGenerator.cs
  - src/Whizbang.Generators/EventNamespaceRegistryGenerator.cs
  - src/Whizbang.Generators/MessageTypeCatalogGenerator.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/ConsumedMessageTypesTests.cs
  - tests/Whizbang.Core.Tests/Generated/WhizbangReceptorRegistryQueryConsumedMessagesTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WhizbangReceptorRegistryQueryAdapterTests.cs
  - tests/Whizbang.Core.Tests/Workers/ReceivedInboxMessageBuilderClassificationTests.cs
  - tests/Whizbang.Generators.Tests/ReceptorRegistryQueryGeneratorConsumedMessagesTests.cs
  - tests/Whizbang.Generators.Tests/ConsumedEventNamespacesAgreementTests.cs
  - tests/Whizbang.Generators.Tests/EventNamespaceRegistryGeneratorConsumerKindsTests.cs
  - tests/Whizbang.Generators.Tests/MessageTypeCatalogGeneratorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ConsumedEventReachesEventStoreTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AbsorbedEventReachesEventStoreTests.cs
---

# Receptor Registry Query

The receptor registry is generated at compile time. For every assembly with receptors, perspectives or tag consumers,
the generator emits a `ReceptorRegistryContribution` and registers it at module load; the static
`WhizbangReceptorRegistryQuery` aggregates every contribution in the process. No reflection is involved, so it works
under AOT, and every reader sees the same data.

It is read through two interfaces, both implemented by one instance (`WhizbangReceptorRegistryQueryAdapter`), which
`AddWhizbang()` registers for both:

| Interface | Question | Readers |
|---|---|---|
| `IReceptorRegistryQuery` | Which lifecycle stages have receptors for a type, and which types this service handles (`GetHandledMessages`, with contract namespace and kind) | The inbox dispatch worker's lifecycle gate; routing, which builds inbox subscriptions and the topology manifest from the handled list |
| `IConsumerRegistry` | Does anything here consume a type (`HasAnyConsumer`), and which types does it consume (`GetConsumedMessages`, `GetConsumedEventTypes`) | The receive boundary's keep-or-discard gate; stream integrity; the subscription-expansion backfill; the orphan-inbox janitor; the receive path's event classification |

`IReceptorRegistryQuery` extends `IConsumerRegistry`. A test or custom implementation that only answers the
predicates still compiles: every list member has a default that returns an empty list.

## What a service consumes {#what-a-service-consumes}
{verified: WhizbangReceptorRegistryQueryConsumedMessagesTests.ThisAssemblysGeneratedRegistration_EnumeratesExactlyWhatHasAnyConsumerAcceptsAsync, ReceptorRegistryQueryGeneratorConsumedMessagesTests.Generator_EnumeratesExactlyTheAnyConsumerSet_SoTheListAndThePredicateAgreeAsync, ConsumedMessageTypesTests.EventTypeNames_AreTheConsumedEvents_DeduplicatedInOrdinalOrder_WithoutCommandsAsync}

`IConsumerRegistry` is the one answer to "what does this service consume". A message type is consumed when something
registered here accepts it at the receive boundary:

- an inbox receptor (`IReceptor<T>`) or a lifecycle receptor (`[FireAt]`),
- a synchronous receptor (`ISyncReceptor<T>`),
- a perspective that folds it,
- a notification-tag consumer,
- the composite fan-out, or
- the collective sink.

The receive boundary asks it as a predicate (`HasAnyConsumer`) to keep or discard each inbound message. Everything
else asks it as a list. `GetConsumedMessages` returns one `ConsumedMessageInfo` per consumed type: its
assembly-qualified wire form (the form the event store's `event_type` holds; see
[type-name forms](type-name-forms)) and whether it is an event. `GetConsumedEventTypes` is the events alone,
deduplicated and in ordinal order: the list a peer or an audit can be given. `FindConsumedMessage` finds one entry,
ignoring assembly version details.

The predicate and the list are generated from the same data, so they cannot disagree. A test enumerates the list for
a real generated assembly and asks the predicate about each entry, and the generator tests do the same for every
consumer kind.

```csharp{title="Reading the consumed set outside the receive boundary" description="ConsumedMessageTypes resolves the consumer registry, the absorbed namespaces and the receive boundary's keep decision from a service provider" category="Architecture" difficulty="ADVANCED" tags=["consumer-registry","consumed-types","stream-integrity"] framework="NET10" tests=["ConsumedMessageTypesTests.EventTypeNames_AreTheConsumedEvents_DeduplicatedInOrdinalOrder_WithoutCommandsAsync","ConsumedMessageTypesTests.AbsorbedNamespaces_AreTheRoutingOptionsAbsorbedNamespaces_LowercaseAndOrderedAsync","ConsumedMessageTypesTests.Keeps_AnUnconsumedTypeInAnAbsorbedNamespace_WhenTheDiscardPolicyKeepsItAsync"]}
// The consumed event types, in the wire form. Empty when nothing here consumes an event.
IReadOnlyList<string> consumed = ConsumedMessageTypes.EventTypeNames(services);

// The namespaces this service stores although nothing consumes them.
IReadOnlyList<string> absorbed = ConsumedMessageTypes.AbsorbedNamespaces(services);

// The receive boundary's own keep-or-discard decision, as a predicate over type names.
Predicate<string> keeps = ConsumedMessageTypes.Keeps(services);
```

### What it does not list {#what-the-consumer-registry-does-not-list}
{verified: ConsumedMessageTypesTests.Keeps_ATypeARuntimeReceptorConsumesAsync, ConsumedMessageTypesTests.Keeps_WithNoRegistry_KeepsNothingAsync}

- **Runtime receptors.** A receptor registered after startup (a control-plane receptor, a test wait) carries no
  compile-time metadata. The receive gate still keeps its messages, because it also asks the runtime receptor
  registry, but the list does not include it, so a list reader such as the integrity audit does not see it.
- **Composites as events.** A composite is listed as consumed but not as an event. The composite itself is never
  stored, only the children it fans out into, so stream integrity never audits it.
- **Absorbed namespaces.** An event in a namespace the service absorbs (`RoutingOptions.AbsorbNamespaces`) is stored
  on purpose with no consumer, so it is not in the registry. `ConsumedMessageTypes.Keeps` keeps it through the discard
  policy, and stream integrity carries the absorbed namespaces separately (see
  [absorbed namespaces travel on the request](../../resilience/stream-integrity#absorbed-namespaces-on-the-request)).

### Other type sources answer other questions {#other-type-sources}

| Source | Answers | Not |
|---|---|---|
| `IConsumerRegistry` | The types something here consumes | Absorbed namespaces, runtime receptors |
| `RoutingOptions.AbsorbedNamespaces` | Namespaces stored here with no consumer | Individual types |
| `IEventTypeProvider` | The events this service's perspectives fold, plus collective events | The consumed set: a service with no perspectives has none, and a receptor-only event is never in it |
| `IMessageTypeCatalog` | Every message type the application declares, with its kind | What this service consumes |

Perspective-specific work (the perspective worker's deserialization, the dispatcher's perspective cache) keeps reading
`IEventTypeProvider`. Every question about the consumed set reads `IConsumerRegistry`.

### Subscriptions cover every consumed event's namespace {#subscriptions-cover-consumed-namespaces}
{verified: ConsumedEventNamespacesAgreementTests.EveryConsumedEventsNamespace_IsAmongTheSubscribedEventNamespacesAsync, EventNamespaceRegistryGeneratorConsumerKindsTests.TaggedSyncAndCollectiveEvents_AreSubscribedAsReceptorNamespacesAsync, EventNamespaceRegistryGeneratorConsumerKindsTests.TypesThatAreNotConcreteNamespacedConsumedEvents_AddNoNamespaceAsync}

The event-namespace registry decides which transport subscriptions a service creates. It discovers the same consumer
kinds as the consumer registry, including synchronous receptors, notification tags and collective events, so every
consumed event's namespace is subscribed. A test checks the agreement in one direction only: every consumed event's
namespace must be subscribed. The namespace registry may subscribe more (it is not derived from the consumer
registry), but never less, because an event whose namespace has no subscription is never delivered.

## Classifying a received message {#classifying-a-received-message}
{verified: ReceivedInboxMessageBuilderClassificationTests.WithNoPerspectives_AConsumedEvent_IsAnEventAsync, ReceivedInboxMessageBuilderClassificationTests.WithAPerspective_AReceptorOnlyEvent_IsAnEventAsync, ReceivedInboxMessageBuilderClassificationTests.AnUnconsumedTypeTheCatalogDeclaresAnEvent_IsAnEvent_EvenAsJsonAsync, ReceivedInboxMessageBuilderClassificationTests.AnUnconsumedPlainMessage_IsNotAnEventAsync, ReceivedInboxMessageBuilderClassificationTests.ATypeKnownByAFormerName_IsClassifiedByItsCatalogEntryAsync}

The receive path marks each inbound message as an event or not; an event is copied into the event store. A transport
payload arrives as JSON, so the payload's own `IEvent` marker cannot be trusted to say. The first source that knows
the type decides:

| Order | Source | Decides for |
|---|---|---|
| 1 | The consumer registry's event flag (`FindConsumedMessage`) | A type this service consumes |
| 2 | The message type catalog's declared kind, by current or former name | A type the application declares but this service does not consume, such as an event in an absorbed namespace |
| 3 | The perspective event list | A perspective event, when no registry is registered |
| 4 | The payload's `IEvent` marker | Anything else |

{verified: ConsumedEventReachesEventStoreTests.WithNoPerspectives_AConsumedEvent_IsCopiedIntoTheEventStoreAsync, ConsumedEventReachesEventStoreTests.WithAPerspectiveOnAnotherEvent_AReceptorOnlyEvent_IsCopiedIntoTheEventStoreAsync, AbsorbedEventReachesEventStoreTests.AnAbsorbedEventReceivedAsJson_WithOnlyTheCatalogToNameIt_IsCopiedIntoTheEventStoreAsync}

**Why the registry comes first.** The receive path used to classify by the perspective event list. A receptor-only
event in a service with perspectives, and every event in a service with none, was stored as a non-event and never
reached the event store. The integration tests send each case through the real receive path and read the event store.

**Why the catalog comes second.** An absorbed event has no consumer, so the registry does not know it, and as JSON its
payload marker cannot say. The catalog the generator emits for the contracts assembly declares each type's kind, so it
can. A living type's own name wins over another entry's former name.

### Catalog kinds {#catalog-kinds}
{verified: MessageTypeCatalogGeneratorTests.Generator_APlainMessage_IsKindMessage_NotEventAsync}

The catalog declares each message type one of four kinds:

| Kind | Type |
|---|---|
| `command` | An `ICommand` |
| `event` | An `IEvent` |
| `message` | A plain `IMessage`, neither command nor event |
| `perspective` | A perspective model |

A plain message is kind `message`, never `event`, so it is not classified as an event or stored in the event store. It
still publishes where it did, so topology and provisioning are unchanged.
