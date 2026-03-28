---
title: Glossary
version: 1.0.0
category: Getting Started
order: 5
description: >-
  Definitions of key terms and concepts used throughout Whizbang documentation -
  CQRS, event sourcing, perspectives, receptors, and framework-specific terminology
tags: 'glossary, terminology, definitions, concepts, vocabulary, reference'
lastMaintainedCommit: '01f07906'
---

# Glossary

Quick reference for Whizbang terminology. Terms link to their full documentation.

---

## A

**AOT (Ahead-of-Time Compilation)**
Native AOT compilation that eliminates runtime reflection. Whizbang achieves zero-reflection via source generators. See [Native AOT](../operations/deployment/native-aot.md).

**Apply Method**
A pure function on a [Perspective](#perspective) that transforms the current model state given an event. Must be synchronous, deterministic, and free of side effects.

**ApplyResult**
Return type for [Perspectives with Actions](../fundamentals/perspectives/perspectives-with-actions.md) that supports Delete/Purge in addition to normal updates.

**Auto-Populate**
Attributes that automatically set message properties from envelope context (timestamps, service info, identifiers). See [Auto-Populate](../extending/attributes/auto-populate.md).

## C

**Cascade**
Automatic routing of events returned by a [Receptor](#receptor) to the outbox, event store, or local processing. See [Dispatcher](../fundamentals/dispatcher/dispatcher.md#auto-cascade-to-outbox).

**CascadeContext**
Security and scope context that flows through message hops. See [Cascade Context](../fundamentals/messages/cascade-context.md).

**Command**
A message representing intent or a request for action (e.g., `CreateOrder`). Implements `ICommand`. Routed point-to-point via shared inbox topic. See [Commands and Events](../messaging/commands-events.md).

**CorrelationId**
A value object that links related messages across a distributed workflow. Propagated automatically through message hops.

## D

**Delivery Receipt**
Acknowledgment returned by `SendAsync` containing MessageId, CorrelationId, Status, and metadata. See [Delivery Receipts](../fundamentals/messages/delivery-receipts.md).

**Dispatcher**
The central message router providing three patterns: `SendAsync` (commands), `LocalInvokeAsync` (RPC), `PublishAsync` (events). See [Dispatcher Guide](../fundamentals/dispatcher/dispatcher.md).

**DispatchMode**
Flags enum controlling where messages route: `Local`, `Outbox`, `Both`, `EventStoreOnly`, `LocalNoPersist`. See [Dispatcher](../fundamentals/dispatcher/dispatcher.md#dispatch-mode).

## E

**Envelope**
Wrapper around a message payload containing hops, tracing context, scope deltas, and metadata. See [Message Envelopes](../messaging/message-envelopes.md).

**Event**
A message representing a fact or something that happened (e.g., `OrderCreated`). Implements `IEvent`. Published via namespace-based topics. See [Events](../fundamentals/events/events.md).

**Event Store**
Append-only storage for events organized by stream. Supports polymorphic reads and sync verification. See [Event Store](../fundamentals/events/event-store.md).

**Event Stream**
A sequence of events grouped by [StreamId](#streamid), representing the history of an aggregate.

## F

**FireAt Attribute**
Declarative attribute that controls when a [Lifecycle Receptor](#lifecycle-receptor) executes in the message processing pipeline. See [Lifecycle Receptors](../fundamentals/receptors/lifecycle-receptors.md).

## G

**Global Perspective**
A [Perspective](#perspective) that aggregates events across multiple streams using a partition key. See [Multi-Stream Perspectives](../fundamentals/perspectives/multi-stream.md).

## H

**Hop**
A record of a message passing through a service. Envelopes accumulate hops for distributed tracing. See [Message Context](../fundamentals/messages/message-context.md).

## I

**Inbox**
Incoming message store for exactly-once deduplication. Messages received from transport are stored and deduplicated before processing. See [Inbox Pattern](../messaging/inbox-pattern.md).

## L

**Lens**
Read-side query interface for querying [Perspective](#perspective) data. Supports scoping, filtering, and multi-model queries. See [Lenses Guide](../fundamentals/lenses/lenses.md).

**Lifecycle Coordinator**
Singleton that manages stage transitions, guarantees exactly-once firing, and coordinates WhenAll completion across processing paths. See [Lifecycle Coordinator](../fundamentals/lifecycle/lifecycle-coordinator.md).

**Lifecycle Receptor**
A [Receptor](#receptor) decorated with `[FireAt]` that executes at a specific stage in the message processing pipeline. See [Lifecycle Receptors](../fundamentals/receptors/lifecycle-receptors.md).

**Lifecycle Stage**
One of 24 stages in the message processing pipeline (Immediate, LocalImmediate, Distribute, Outbox, Inbox, Perspective, PostAllPerspectives, PostLifecycle). See [Lifecycle Stages](../fundamentals/lifecycle/lifecycle-stages.md).

## M

**Message**
Base marker interface (`IMessage`) for all message types. Subtypes: `ICommand`, `IEvent`, `IQuery`. See [Messages](../fundamentals/messages/messages.md).

**MessageId**
Value object uniquely identifying a message instance. Generated as UUIDv7 (time-ordered).

## O

**Outbox**
Transactional outbox for reliable event publishing. Events are persisted atomically with business data, then published asynchronously. See [Outbox Pattern](../messaging/outbox-pattern.md).

## P

**Perspective**
A pure-function event handler that maintains an eventually-consistent read model. The "Q" in CQRS. See [Perspectives Guide](../fundamentals/perspectives/perspectives.md).

**Physical Field**
A perspective model property extracted to a dedicated database column for native indexing. See [Physical Fields](../fundamentals/perspectives/physical-fields.md).

**PostLifecycle**
Terminal lifecycle stage that fires exactly once per event after all processing paths complete. Managed by [Lifecycle Coordinator](../fundamentals/lifecycle/lifecycle-coordinator.md).

## R

**Receptor**
A stateless message handler that encapsulates business logic. Receives commands/queries and returns events/responses. See [Receptors Guide](../fundamentals/receptors/receptors.md).

**Rebuild**
Reconstructing a [Perspective](#perspective)'s read model from event history. Modes: Blue-Green, In-Place, Selected Streams. See [Perspective Rebuild](../fundamentals/perspectives/rebuild.md).

**Route**
Static factory class for controlling message dispatch: `Route.Local()`, `Route.Outbox()`, `Route.Both()`, `Route.None()`, `Route.EventStoreOnly()`.

## S

**Scope**
Security and authorization context (tenant, user, roles) that propagates through message envelopes. See [Scoping](../fundamentals/security/scoping.md).

**Source Generator**
Roslyn-based compile-time code generator that enables zero-reflection, AOT-compatible type discovery. See [Source Generators](../extending/source-generators/configuration.md).

**StreamId**
Property marked with `[StreamId]` that identifies which event stream a message belongs to. Required on all events and perspective models. See [Stream ID](../fundamentals/events/stream-id.md).

**StreamKey**
Alias for [StreamId](#streamid). The `[StreamKey]` attribute marks the stream identifier property.

## T

**Tag**
Declarative cross-cutting concern attached to messages via attributes. Tags fire at every lifecycle stage. See [Message Tags](../fundamentals/messages/message-tags.md).

**Temporal Perspective**
An append-only [Perspective](#perspective) that creates a new row per event (INSERT not UPSERT). Used for activity feeds and audit logs. See [Temporal Perspectives](../fundamentals/perspectives/temporal.md).

**Transport**
Message broker integration (RabbitMQ, Azure Service Bus, In-Memory). See [Transports](../messaging/transports/transports.md).

## V

**Vector Field**
A perspective model property storing embeddings for similarity search via pgvector. See [Vector Fields](../fundamentals/perspectives/vector-fields.md).

## W

**WhenAll**
Pattern where [PostLifecycle](#postlifecycle) fires only after all processing paths complete. Used for `Route.Both()` events and multi-perspective coordination. See [Lifecycle Coordinator](../fundamentals/lifecycle/lifecycle-coordinator.md#whenall).

**Work Coordinator**
Distributed batch processing system with lease-based coordination, partition distribution, and stream ordering. See [Work Coordinator](../messaging/work-coordinator.md).
