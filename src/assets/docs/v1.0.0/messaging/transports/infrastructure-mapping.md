---
title: Infrastructure Mapping
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Transports
order: 3
description: >-
  How Whizbang's provider-agnostic abstractions - topic, stream, partition,
  and sequence - map onto concrete message transports (in-memory, RabbitMQ,
  Azure Service Bus)
tags: >-
  transports, topic, stream, partition, partition-router, sequence, policies,
  routing, rabbitmq, azure-service-bus, provider-agnostic
codeReferences:
  - src/Whizbang.Core/Policies/PolicyConfiguration.cs
  - src/Whizbang.Core/Policies/PolicyContext.cs
  - src/Whizbang.Core/Policies/IPolicyEngine.cs
  - src/Whizbang.Core/Partitioning/HashPartitionRouter.cs
  - src/Whizbang.Core/Transports/TransportType.cs
  - src/Whizbang.Core/Transports/PublishTarget.cs
  - src/Whizbang.Core/Transports/SubscriptionTarget.cs
  - src/Whizbang.Core/Sequencing/ISequenceProvider.cs
  - src/Whizbang.Core/Workers/TransportPublishStrategy.cs
  - src/Whizbang.Transports.RabbitMQ/RabbitMQTransport.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusTransport.cs
  - src/Whizbang.Core/Observability/MessageEnvelope.cs
  - src/Whizbang.Core/Observability/MessageHop.cs
  - src/Whizbang.Core/Observability/CallerInfo.cs
testReferences:
  - tests/Whizbang.Policies.Tests/PolicyConfigurationExtensionsTests.cs
  - tests/Whizbang.Policies.Tests/PolicyConfigurationTransportTests.cs
  - tests/Whizbang.Partitioning.Tests/HashPartitionRouterTests.cs
  - tests/Whizbang.Policies.Tests/PolicyContextTests.cs
  - tests/Whizbang.Transports.Tests/TransportManagerSubscriptionTests.cs
  - tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusTransportUnitTests.cs
  - tests/Whizbang.Observability.Tests/MessageTracingTests.cs
---

# Infrastructure Mapping

Whizbang describes routing and ordering in **provider-agnostic** terms. Your
policies talk about a **topic**, a **stream**, a **partition count**, and a
**partition router** - never about a RabbitMQ exchange or a Service Bus session.
The transport layer translates those abstractions into whatever the underlying
broker actually understands, so the same policy configuration can front an
in-memory transport in tests and a real broker in production.

This page explains the four abstractions, how partition routing works, and how
each concept lands on the transports Whizbang ships today.

## The routing abstractions

A matched policy returns a `PolicyConfiguration`
(`src/Whizbang.Core/Policies/PolicyConfiguration.cs`) whose routing surface is
just four settable values:

| Concept | Policy setter | Stored as | Meaning |
|---------|---------------|-----------|---------|
| **Topic** | `UseTopic(string)` | `Topic` | Logical routing destination - the "where" of the message. |
| **Stream** | `UseStreamId(string)` | `StreamId` | Ordering boundary - messages sharing a stream key are processed in order. |
| **Partition** | `WithPartitions(int)` + `UsePartitionRouter<T>()` | `PartitionCount`, `PartitionRouterType` | Physical parallelism - how the stream space is sharded across concurrent consumers. |
| **Sequence** | `UseSequenceProvider<T>()` | `SequenceProviderType` | Per-scope monotonic ordering number assigned to persisted messages. |

Two rules keep the layers honest:

- **Stream is the ordering unit.** A stream key (e.g. `order-12345`) always
  resolves to the same partition, so per-stream order survives sharding.
- **Partition is an implementation detail.** It exists for throughput. Ordering
  is guaranteed *within* a partition/stream, never across partitions.

### Topic

The logical destination. Set with `UseTopic("orders")`; the value is exposed on
`PolicyConfiguration.Topic`.

> Verified: `UseTopic` sets `Topic` and returns `this` for chaining -
> `tests/Whizbang.Policies.Tests/PolicyConfigurationExtensionsTests.cs:UseTopic_ShouldSetTopicAsync`.

### Stream

The ordering boundary. Set with `UseStreamId("order-12345")`; exposed on
`PolicyConfiguration.StreamId`. All messages carrying the same stream key are
kept in order relative to each other.

> Verified: `UseStreamId` sets `StreamId` and is fluent -
> `tests/Whizbang.Policies.Tests/PolicyConfigurationExtensionsTests.cs:UseStreamId_ShouldSetStreamIdAsync`.

### Partition

Physical parallelism. `WithPartitions(int)` sets the shard count (rejecting
values `<= 0`), and `UsePartitionRouter<TRouter>()` selects the routing strategy.

> Verified: `WithPartitions` stores the count and throws on zero/negative -
> `tests/Whizbang.Policies.Tests/PolicyConfigurationExtensionsTests.cs:WithPartitions_WithZero_ShouldThrowAsync`,
> `WithPartitions_WithNegative_ShouldThrowAsync`.

### Sequence

A monotonic ordering number. `UseSequenceProvider<TProvider>()` picks the
implementation of `ISequenceProvider`
(`src/Whizbang.Core/Sequencing/ISequenceProvider.cs`). Whizbang ships an
in-memory provider (`InMemorySequenceProvider`) plus persistent Dapper-based
providers for Postgres (`DapperPostgresSequenceProvider`) and SQLite
(`DapperSqliteSequenceProvider`).

---

## Partition routing

`WithPartitions(n)` alone only declares the shard count; the **partition
router** decides which partition a given stream key lands in. The built-in
`HashPartitionRouter` (`src/Whizbang.Core/Partitioning/HashPartitionRouter.cs`)
implements `IPartitionRouter.SelectPartition(streamKey, partitionCount, context)`
using **consistent hashing**:

- Hashes the stream key with **FNV-1a** (a fast, non-cryptographic hash).
- Maps to a partition with `Math.Abs(hash % partitionCount)`.
- **Same key always resolves to the same partition** - this is what preserves
  per-stream ordering across a sharded topic.
- Edge cases: a single partition always returns `0`; a null/empty stream key
  routes to partition `0`.

> Verified: deterministic same-key routing, even distribution across partitions,
> and the single-partition edge case -
> `tests/Whizbang.Partitioning.Tests/HashPartitionRouterTests.cs:HashAlgorithm_SameKey_AlwaysProducesSamePartitionAsync`,
> `Distribution_10kStreams_DistributesEvenlyAsync`,
> `EdgeCase_SinglePartition_AlwaysReturnsZeroAsync`.

```csharp{title="Deterministic partition selection for a stream key" description="HashPartitionRouter maps a stream key to a fixed partition via FNV-1a so per-stream order survives sharding." category="Messaging" difficulty="INTERMEDIATE" tags=["partition-router", "hashing", "streams", "ordering"] tests=["HashPartitionRouterTests.HashAlgorithm_SameKey_AlwaysProducesSamePartitionAsync"]}
// Same stream key → same partition, every time
var router = new HashPartitionRouter();
int p = router.SelectPartition("order-12345", partitionCount: 16, context);
// p is stable for "order-12345" across the process lifetime
```

---

## Configuring routing with a policy

Routing configuration is authored through the **policy engine**, not a
transport-specific builder. `IPolicyEngine.AddPolicy(name, predicate, configure)`
(`src/Whizbang.Core/Policies/IPolicyEngine.cs`) registers a named policy; the
first policy whose predicate matches wins, and its `configure` action populates
the `PolicyConfiguration`.

```csharp{title="Author topic, stream, and partitioning on a policy" description="A matched policy populates PolicyConfiguration with a topic, a string stream key, a partition count, and a hash partition router." category="Messaging" difficulty="INTERMEDIATE" tags=["policies", "routing", "streams", "partitions"] tests=["PolicyConfigurationExtensionsTests.PolicyConfiguration_ShouldSupportMethodChainingAsync", "PolicyConfigurationExtensionsTests.UsePartitionRouter_ShouldSetPartitionRouterTypeAsync", "PolicyContextTests.MatchesAggregate_ReturnsTrue_WhenMessageIsForSpecifiedAggregateTypeAsync"]}
policyEngine.AddPolicy(
    name: "order-routing",
    predicate: ctx => ctx.MatchesAggregate<Order>(),
    configure: config => config
        .UseTopic("orders")                        // logical topic
        .UseStreamId($"order-{orderId}")           // ordering boundary (a string)
        .WithPartitions(16)                        // 16 shards
        .UsePartitionRouter<HashPartitionRouter>() // consistent-hash routing
);
```

`PolicyContext.MatchesAggregate<TAggregate>()` matches by naming convention (the
message type name contains the aggregate type name), and
`PolicyContext.GetAggregateId()` extracts the `[StreamId]`-marked value via a
source-generated extractor (zero reflection).

> Verified: `MatchesAggregate<T>()` matches on message-type naming and
> `GetAggregateId()` reads the `[StreamId]` property -
> `tests/Whizbang.Policies.Tests/PolicyContextTests.cs:MatchesAggregate_ReturnsTrue_WhenMessageIsForSpecifiedAggregateTypeAsync`,
> `GetAggregateId_WithStreamIdAttribute_ReturnsExtractedIdAsync`.

> Note: `UseStreamId` takes a **string** stream key, not a lambda. Compute the
> key from the message (e.g. via `GetAggregateId()`) inside your `configure`
> action.

For the full policy model - predicates, decision trails, execution strategies,
and concurrency - see [Policy-Based Routing](../../operations/infrastructure/policies.md).

---

## Transport support matrix

The transport a message rides on is identified by `TransportType`
(`src/Whizbang.Core/Transports/TransportType.cs`). The enum enumerates five
values, but **not all of them have a shipping transport driver**:

| `TransportType` | Enum value | Ships a transport driver? |
|-----------------|-----------:|---------------------------|
| `InProcess` | 4 | Yes - `InProcessTransport` (in-memory, tests & single-process) |
| `RabbitMQ` | 2 | Yes - `RabbitMQTransport` |
| `ServiceBus` | 1 | Yes - `AzureServiceBusTransport` |
| `Kafka` | 0 | Declared in the enum and policy API; **no transport driver ships in this repo** |
| `EventStore` | 3 | Declared in the enum; **no transport driver ships in this repo** |

> Verified: `InProcessTransport`, `RabbitMQTransport`, and
> `AzureServiceBusTransport` are the only concrete `ITransport`
> implementations under `src/`. No Kafka or EventStore transport project exists.
> The enum values themselves are covered by
> `tests/Whizbang.Policies.Tests/PolicyConfigurationTransportTests.cs:TransportType_ShouldHaveKafkaValueAsync`
> (and the `ServiceBus`/`RabbitMQ`/`EventStore`/`InProcess` siblings).

The `Kafka` and `EventStore` enum values exist so that policy publish/subscribe
targets can be *authored* against them (see below), but without a driver those
targets have nowhere to run today. Treat them as reserved, not production-ready.

---

## Concept-to-transport mapping

How the abstractions land on the transports that actually ship:

| Whizbang concept | In-Memory (`InProcess`) | RabbitMQ | Azure Service Bus |
|------------------|-------------------------|----------|-------------------|
| **Topic** | Handler key | Exchange (`destination.Address`) | Topic |
| **Stream** | (in-order dispatch) | AMQP header (destination metadata) | **`SessionId`** |
| **Ordering** | Per process | Per queue | Per session |
| **CorrelationId** | Envelope field | `BasicProperties.CorrelationId` | `ServiceBusMessage.CorrelationId` |

### How the stream key travels

The publish strategy
(`src/Whizbang.Core/Workers/TransportPublishStrategy.cs`) carries the message's
`StreamId` in the transport destination's **metadata** for *every* broker - it
does not itself set a routing key or a session. Each transport then interprets
that metadata differently, and this is where "stream" stops being a single
uniform mechanism:

- **Azure Service Bus turns the stream into a session.** It reads `StreamId` out
  of the destination metadata and sets `message.SessionId = streamId`, giving
  FIFO ordering per session. Bulk sends are grouped by `StreamId` so a single
  `ServiceBusMessageBatch` never mixes sessions (ASB requires one `SessionId`
  per batch). Session ordering is opt-in via `EnableSessions`; the transport
  only advertises the `Ordered` capability when sessions are enabled.
  > Verified: `src/Whizbang.Transports.AzureServiceBus/AzureServiceBusTransport.cs`
  > (SessionId-from-StreamId at the publish path; per-`StreamId` batch grouping) and
  > `tests/Whizbang.Transports.AzureServiceBus.Tests/AzureServiceBusTransportUnitTests.cs:Capabilities_WithEnableSessions_IncludesOrderedAsync`,
  > `Capabilities_WithoutEnableSessions_ExcludesOrderedAsync`. See also
  > [Azure Service Bus Transport](./azure-service-bus.md).

- **RabbitMQ carries the stream as a header, not a routing key.** It copies every
  destination-metadata entry (including `StreamId`) onto the AMQP message
  `BasicProperties.Headers`, and sets the routing key **independently** from
  `destination.RoutingKey`, defaulting to `#`. RabbitMQ does **not** derive the
  routing key from the stream key and has no session/stream-affinity mechanism in
  this transport - ordering is per-queue only. It also copies the envelope's
  correlation id onto `BasicProperties.CorrelationId`.
  > Verified: `src/Whizbang.Transports.RabbitMQ/RabbitMQTransport.cs` (routing key
  > `destination.RoutingKey ?? "#"`; destination metadata copied into
  > `BasicProperties.Headers`). See also [RabbitMQ Transport](./rabbitmq.md).

So only Azure Service Bus promotes a Whizbang stream into a broker-level ordering
guarantee. On RabbitMQ the stream id rides along for observability/correlation
but does not steer routing or ordering; use partitioned queues plus per-queue
ordering when you need it there.

> [unverified] The mappings for Kafka (topic → Kafka topic, stream → partition
> key, partition → partition 0..N, sequence → offset) and EventStore (topic →
> `$category-*`, stream → stream id, sequence → event number) describe the
> *intended* alignment of the model, but no Kafka or EventStore transport driver
> ships in this repo, so these rows cannot be confirmed against a running
> implementation.

---

## Authoring publish / subscribe targets

Beyond `UseTopic`/`UseStreamId`, a policy can declare **where a message is
published** and **where a service subscribes** per transport. These add entries
to `PolicyConfiguration.PublishTargets` (`PublishTarget`) and
`SubscriptionTargets` (`SubscriptionTarget`).

Publish helpers:

```csharp{title="Declare per-transport publish targets on a policy" description="PublishToKafka/ServiceBus/RabbitMQ append typed PublishTargets; RabbitMQ takes an exchange plus routing key." category="Messaging" difficulty="INTERMEDIATE" tags=["publish-targets", "policies", "rabbitmq", "service-bus"] tests=["PolicyConfigurationTransportTests.PolicyConfiguration_PublishToKafka_ShouldAddPublishTargetAsync", "PolicyConfigurationTransportTests.PolicyConfiguration_PublishToServiceBus_ShouldAddPublishTargetAsync", "PolicyConfigurationTransportTests.PolicyConfiguration_PublishToRabbitMQ_ShouldAddPublishTargetAsync"]}
config.PublishToKafka("orders");                        // TransportType.Kafka
config.PublishToServiceBus("orders");                   // TransportType.ServiceBus
config.PublishToRabbitMQ("orders.exchange", "order.*"); // exchange + routing key
```

Subscribe helpers:

```csharp{title="Declare per-transport subscription targets on a policy" description="SubscribeFromKafka/ServiceBus/RabbitMQ append typed SubscriptionTargets with broker-specific fields." category="Messaging" difficulty="INTERMEDIATE" tags=["subscription-targets", "policies", "consumer-group", "sql-filter"] tests=["PolicyConfigurationTransportTests.PolicyConfiguration_SubscribeFromKafka_ShouldAddSubscriptionTargetAsync", "PolicyConfigurationTransportTests.PolicyConfiguration_SubscribeFromServiceBus_ShouldAddSubscriptionTargetAsync", "PolicyConfigurationTransportTests.PolicyConfiguration_SubscribeFromRabbitMQ_ShouldAddSubscriptionTargetAsync"]}
config.SubscribeFromKafka("orders", consumerGroup: "svc", partition: null);
config.SubscribeFromServiceBus("orders", subscriptionName: "svc", sqlFilter: null);
config.SubscribeFromRabbitMQ("orders.exchange", queueName: "svc", routingKey: null);
```

Each helper records a target whose transport-specific fields differ:
`PublishTarget` carries `Destination` (+ optional `RoutingKey`);
`SubscriptionTarget` carries `Topic` plus the fields that matter for that broker
- `ConsumerGroup`/`Partition` (Kafka), `SubscriptionName`/`SqlFilter` (Service
Bus), `QueueName`/`RoutingKey` (RabbitMQ).

> Verified: the publish/subscribe helpers append correctly typed targets -
> `tests/Whizbang.Policies.Tests/PolicyConfigurationTransportTests.cs:PolicyConfiguration_PublishToKafka_ShouldAddPublishTargetAsync`,
> `PolicyConfiguration_PublishToRabbitMQ_ShouldAddPublishTargetAsync`,
> `PolicyConfiguration_SubscribeFromServiceBus_WithFilter_ShouldStoreSqlFilterAsync`;
> and the metadata survives into the transport layer -
> `tests/Whizbang.Transports.Tests/TransportManagerSubscriptionTests.cs:SubscribeFromTargetsAsync_WithKafkaConsumerGroup_ShouldIncludeInMetadataAsync`.

> Note: the `*Kafka` helpers compile and store targets, but there is no Kafka
> driver to consume them (see the support matrix above).

---

## Observability across transports

Whizbang's tracing metadata travels with every message regardless of transport.
The message envelope (`src/Whizbang.Core/Observability/MessageEnvelope.cs`)
carries:

| Field | Where it lives | Notes |
|-------|----------------|-------|
| `MessageId` | Envelope / headers | Stable identity for the message. |
| `CorrelationId` | Message headers / hop scope | Copied onto broker-native correlation fields (RabbitMQ `BasicProperties.CorrelationId`, Service Bus `ServiceBusMessage.CorrelationId`). |
| `CausationId` | Message headers | The message that caused this one. |
| `Hops` | `MessageEnvelope.Hops` (`List<MessageHop>`) | Additive, immutable-once-added trail of the message's path; drives `GetCurrentTopic()`, `GetCurrentStreamId()`, `GetCurrentPartitionIndex()`. |
| `CallerInfo` | `src/Whizbang.Core/Observability/CallerInfo.cs` | Immutable `sealed record` capturing the dispatch call site. |

> Verified: hop-derived accessors on the envelope -
> `tests/Whizbang.Observability.Tests/MessageTracingTests.cs:MessageEnvelope_GetCurrentTopic_ReturnsNull_WhenNoHopsHaveTopicAsync`
> (and the `GetCurrentStreamId`/`GetCurrentPartitionIndex` siblings).

- **Caller data is stored decomposed per hop.** Rather than one blob, each
  `MessageHop` carries `CallerMemberName`, `CallerFilePath`, and
  `CallerLineNumber` (`src/Whizbang.Core/Observability/MessageHop.cs`),
  auto-captured via the `[CallerMemberName]`/`[CallerFilePath]`/`[CallerLineNumber]`
  compiler attributes at the point the hop is recorded.

Two clarifications versus older material:

- The envelope's security metadata is now exposed via **`GetCurrentScope()`**
  (returns a `ScopeContext`). `GetCurrentSecurityContext()` still exists but is
  **`[Obsolete]`** ("Use `GetCurrentScope()` instead").
- The policy audit trail is **`PolicyDecisionTrail`**
  (`src/Whizbang.Core/Policies/PolicyDecisionTrail.cs`), recorded by
  `PolicyEngine.MatchAsync` - see
  [Policy-Based Routing](../../operations/infrastructure/policies.md).

---

## Choosing a transport

Because routing is expressed against the abstractions, the transport choice is
an operational one, not a code one:

- **In-Memory (`InProcess`)** - default for tests and single-process apps; no
  network, no persistence. See [In-Memory Transport](./in-memory.md).
- **RabbitMQ** - flexible exchange/routing-key patterns, dead-letter queues,
  request/reply. Ordering is per-queue; the stream id rides as a header, so it
  does not by itself give per-stream FIFO. See [RabbitMQ Transport](./rabbitmq.md).
- **Azure Service Bus** - Azure-native, session-based FIFO ordering keyed off the
  stream (`SessionId`), scheduled messages, SQL filters. See
  [Azure Service Bus Transport](./azure-service-bus.md).

Switching transports changes registration and deployment, not your policies or
domain logic - the same `UseTopic` / `UseStreamId` / `WithPartitions`
configuration drives whichever driver is registered.

## Related documentation

- [Policy-Based Routing](../../operations/infrastructure/policies.md) - the policy engine, predicates, and decision trails
- [Transports Component](./transports.md) - the `ITransport` interface and in-process transport
- [RabbitMQ Transport](./rabbitmq.md)
- [Azure Service Bus Transport](./azure-service-bus.md)
- [In-Memory Transport](./in-memory.md)
