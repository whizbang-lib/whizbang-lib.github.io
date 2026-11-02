---
title: Superseding Events
pageType: concept
description: >-
  Declare an event type [Superseding] when every event holds the whole state for its key: once a newer event of the
  same type and key is stored on the stream, the older one is deleted with its body and its digest contribution after
  every consumer has processed it. Covers the key, the reaper and its gates, what it means for rebuilds and rewinds,
  integrity digests, received copies, and the WHIZ135 and WHIZ136 build rules.
version: 1.0.0
category: Core Concepts
order: 18
tags: 'events, superseding, latest-wins, full-state, reaper, maintenance, storage, embeddings, WHIZ135, WHIZ136'
codeReferences:
  - src/Whizbang.Core/Attributes/SupersedingAttribute.cs
  - src/Whizbang.Core/Attributes/SupersedingKeyAttribute.cs
  - src/Whizbang.Core/Lifecycle/SupersedingEvents.cs
  - src/Whizbang.Core/Messaging/EventFlags.cs
  - src/Whizbang.Core/Messaging/EventFlagsDeriver.cs
  - src/Whizbang.Core/EventMarkerResolver.cs
  - src/Whizbang.Core/Observability/EnvelopeMetadata.cs
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Workers/ReceivedInboxMessageBuilder.cs
  - src/Whizbang.Data.Postgres/DirectAppendKind.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreEventStore.cs
  - src/Whizbang.Data.Dapper.Postgres/EventEnvelopeJsonbAdapter.cs
  - src/Whizbang.Data.Postgres/Migrations/295_SupersedingEvents.sql
  - src/Whizbang.Generators/MessageTypeCatalogGenerator.cs
  - src/Whizbang.Generators/SupersedingEventAnalyzer.cs
  - src/Whizbang.Generators/Utilities/SupersedingResolver.cs
testReferences:
  - tests/Whizbang.Core.Tests/Lifecycle/SupersedingEventsTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventFlagsTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventFlagsDeriverTests.cs
  - tests/Whizbang.Core.Tests/Messaging/DirectAppendKindTests.cs
  - tests/Whizbang.Core.Tests/EventMarkerResolverCoverageTests.cs
  - tests/Whizbang.Core.Tests/Observability/EnvelopeMetadataSlimFormTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherSupersedingKeyTests.cs
  - tests/Whizbang.Core.Tests/Workers/ReceivedInboxMessageBuilderSupersedingKeyTests.cs
  - tests/Whizbang.Generators.Tests/MessageTypeCatalogGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/SupersedingEventAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SupersedingEventReaperSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperSupersedingKeyTests.cs
---

# Superseding Events

Some event types never describe a change: each event carries the whole current state of one thing. A document's
embedding is recomputed and published in full; a user's permission set is replaced wholesale. For such a type, every
event but the newest of each key is redundant once it has been consumed, and keeping it costs storage forever.

Declare the type `[Superseding]` and Whizbang keeps only the newest event of each key on each stream. An older event is
deleted, with its body and its contribution to the stream's integrity digest, once a newer event of the same type and
key is stored on the same stream and every consumer has processed the older one.

{verified: SupersedingEventReaperSqlTests.Reap_SupersededAndConsumed_IsDeletedWithItsBodyAndItsDigestContribution_TheNewestIsKeptAsync}

```csharp{
title: "A superseding event keyed by its embedding model"
description: "Each event holds the whole embedding of one document for one model; a newer event for the same document and model replaces the older one."
framework: "NET10"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["events", "superseding", "latest-wins", "embeddings"]
tests: ["SupersedingEventsTests.AttributedTypesInThisAssembly_AreRegisteredByTheGenerator_WithTheirKeyAsync", "DispatcherSupersedingKeyTests.PublishAsync_ASupersedingEvent_CarriesTheFlagAndItsKey_AnOrdinaryEventNeitherAsync"]
}
[Superseding]
public sealed record DocumentEmbeddingUpdated(
    [property: StreamId] Guid DocumentId,
    [property: SupersedingKey] string Model,
    float[] Vector) : IEvent;
```

## Full-state payloads only {#full-state-payloads-only}

`[Superseding]` is a promise about the payload: every event carries everything a consumer needs for its key, so
nothing is lost when an older event goes. Use it only when that is true.

What the promise costs:

- **State as of an earlier point cannot be reconstructed for this type.** Once an older event is reaped, a rebuild or a
  rewind replays the newest event of each key and never the older ones, so a perspective rebuilt from the log ends in
  the current state, but nothing can show what the state was before the newest event of a key.
- **Nothing else may depend on an older event.** A perspective that derives something from an intermediate state (a
  count of updates, a value that another event combined with the older payload) would compute a different answer
  after a rebuild. Keep such derivations off superseding types.

{verified: EventFlagsTests.EventFlags_Superseding_BitPositionLocked_AndItIsNotStateBasedAsync}

| Choice | Reason | Verified |
|---|---|---|
| A superseding event is **not** StateBased: the rebuild and rewind guards replay it like any Sourced event. | The newest event of each key stays in the log, so replaying the surviving events reproduces the current state. Counting it StateBased would make a rebuild skip every stream holding one, and the mixed-stream guard (WHIZ133) refuse a superseding event on a stream of ordinary events, which is exactly where an embedding or a permission snapshot lives. | {verified: EventFlagsTests.EventFlags_Superseding_BitPositionLocked_AndItIsNotStateBasedAsync} |
| The flag is `EventFlags.Superseding`, bit 7 (`128`). | Bits 0 to 6 were taken (bit 5 by `AtMostOnce`, bit 6 by `Terminal`); the SQL write paths and the reaper test `flags & 128`. | {verified: EventFlagsTests.EventFlags_Superseding_BitPositionLocked_AndItIsNotStateBasedAsync} |

## The key {#the-key}

The key names what an event holds the state of. A newer event supersedes an older one only when both are on the same
stream, of the same type, with the same key.

- Mark one property `[SupersedingKey]`, on a property or on a record's primary-constructor parameter (which marks the
  property of the same name). A key on a base type is the derived type's key.
- A type with no `[SupersedingKey]` has one key per stream: only its newest event on each stream is kept.
- The key is stored in `wh_event_store.supersede_key` as invariant text.

{verified: SupersedingEventsTests.KeyText_IsInvariantText_WhateverTheCurrentCultureAsync, MessageTypeCatalogGeneratorTests.Generator_SupersedingEvent_StampsTheEntryAndRegistersTheKeyAsync}

| Choice | Reason | Verified |
|---|---|---|
| The key is stamped when the event is stored, from the payload, on every write path: the dispatcher's outbox row, a received inbox row, and a direct `IEventStore.AppendAsync` on both drivers. It travels in the stored metadata as `sk`, and the SQL copies it only onto a row flagged superseding. | One key, computed once by a generated accessor and never by reflection, reaches the event store whatever path stored the event. A stray `sk` on another row is never read. | {verified: DispatcherSupersedingKeyTests.PublishAsync_ASupersedingEvent_CarriesTheFlagAndItsKey_AnOrdinaryEventNeitherAsync, DispatcherSupersedingKeyTests.Cascade_ASupersedingEventAReceptorReturns_CarriesItsKeyAsync, SupersedingEventReaperSqlTests.Emit_Outbox_StampsTheKeyOnlyOnASupersedingEvent_AndQueuesTheOlderOneAsync, SupersedingEventReaperSqlTests.DirectAppend_StampsTheKey_AndQueuesTheOlderOneAsync, DapperSupersedingKeyTests.AppendAsync_ASupersedingEvent_IsKeyed_AndTheOlderOfItsKeyIsQueuedAsync} |
| The key is invariant text: a string as is, a number, `Guid` or date in its invariant form, anything else by `ToString()`. | A host's culture must never split one key into two (`1,5` and `1.5`). | {verified: SupersedingEventsTests.KeyText_IsInvariantText_WhateverTheCurrentCultureAsync} |
| A type with no key property has the empty key, so it keeps one event per stream. | Many full-state types describe the stream itself (a profile, a permission set); requiring a key for them would only add a constant. | {verified: SupersedingEventsTests.AttributedTypesInThisAssembly_AreRegisteredByTheGenerator_WithTheirKeyAsync, MessageTypeCatalogGeneratorTests.Generator_SupersedingEvent_StampsTheEntryAndRegistersTheKeyAsync} |
| An event whose key property is `null` is stored with no key, and is never superseded and never supersedes another. | An unknown key must not merge with every other unknown key of its type; keeping the event is the recoverable direction. | {verified: SupersedingEventsTests.KeyOf_AKeyPropertyThatIsNull_IsNull_SoTheEventIsNeverSupersededAsync, SupersedingEventReaperSqlTests.Emit_Outbox_StampsTheKeyOnlyOnASupersedingEvent_AndQueuesTheOlderOneAsync} |
| Only an event can be superseding; `[Superseding]` on a command is ignored. | Only an event is stored on a stream. | {verified: MessageTypeCatalogGeneratorTests.Generator_SupersedingEvent_StampsTheEntryAndRegistersTheKeyAsync} |
| The flag name parser that reads `Flags` written as names (`"Superseding"`) knows the new bit. | A name it does not know is refused (22P02), which would refuse every superseding event written by a host that serializes enums as names. | {verified: SupersedingEventReaperSqlTests.Emit_FlagsWrittenAsNames_StampTheKeyOfASupersedingEventAsync} |

## The reaper {#the-reaper}

Storing an event with a key queues the older events of its stream, type and key in `wh_superseded_events`. The
maintenance pass (`perform_maintenance`, task `reap_superseded_events`) works through the queue, oldest first, and
deletes a queued event when every gate below holds. An event that fails a gate stays queued and is judged again on
the next pass.

```mermaid{caption="A superseding event is stored, the older event of its key is queued, and the maintenance pass deletes it once every gate holds." tests=["SupersedingEventReaperSqlTests.Emit_Outbox_StampsTheKeyOnlyOnASupersedingEvent_AndQueuesTheOlderOneAsync", "SupersedingEventReaperSqlTests.Reap_SupersededAndConsumed_IsDeletedWithItsBodyAndItsDigestContribution_TheNewestIsKeptAsync"]}
sequenceDiagram
  participant W as Write path (emit chain or direct append)
  participant E as wh_event_store
  participant Q as wh_superseded_events
  participant M as perform_maintenance (reap_superseded_events)
  W->>E: store event v2 (key k), supersede_key = 'k'
  W->>Q: queue v1 (older event of stream, type and key k)
  M->>Q: read the oldest queued events (batch of 5000)
  M->>E: lock their streams, check every gate
  M->>E: subtract v1 from the stream digest, delete its body and pointer
  M->>Q: remove v1 from the queue
```

{verified: SupersedingEventReaperSqlTests.Reap_SupersededAndConsumed_IsDeletedWithItsBodyAndItsDigestContribution_TheNewestIsKeptAsync}

| Gate | Reason | Verified |
|---|---|---|
| A newer event of the same stream, type and key is stored, checked again under the stream's lock. | The newest event of each key is never deleted, whatever the queue says. | {verified: SupersedingEventReaperSqlTests.Reap_TheNewestOfItsKey_IsKept_EvenWhenQueuedAsync, SupersedingEventReaperSqlTests.Reap_ADifferentTypeOrKeyInTheSameStream_IsUntouchedAsync} |
| No perspective work for the event is unprocessed. | Every perspective that consumes it has applied it. | {verified: SupersedingEventReaperSqlTests.Reap_UnprocessedPerspectiveWork_KeepsIt_UntilItIsProcessedAsync} |
| No perspective cursor rests on the event. | A cursor reads from its event onward, and the EF Core schema's foreign key from the cursor to the event is `RESTRICT`. | {verified: SupersedingEventReaperSqlTests.Reap_ACursorOnIt_KeepsIt_UntilTheCursorMovesOnAsync} |
| No perspective snapshot rests on the event. | A rewind restores a snapshot and moves the cursor onto its event, which must still exist. The event goes once snapshot retention replaces that snapshot. | {verified: SupersedingEventReaperSqlTests.Reap_ASnapshotOnIt_KeepsIt_UntilTheSnapshotIsGoneAsync} |
| No destruction hold on the event is active; a lapsed one is removed with it. | A PreDestruction hook's Cancel or Defer is honored here as by every other path that removes an event. | {verified: SupersedingEventReaperSqlTests.Reap_AnActiveDestructionHold_KeepsIt_ALapsedOneDoesNotAsync} |
| The commit-sequence stamper has reached the event. | The stamped order is what epoch digests and ordered reads walk; an event leaves only after it has its place in it. | {verified: SupersedingEventReaperSqlTests.Reap_AnEventTheStamperHasNotReached_IsKeptAsync} |
| The event is still flagged superseding and is Sourced (not ephemeral, not a compaction origin). | Ephemeral events have their own reaper; WHIZ135 refuses the combination at build time and the reaper refuses it at run time. | {verified: SupersedingEventReaperSqlTests.Reap_AnEphemeralRowCarryingTheFlag_IsLeftToTheEphemeralReaperAsync} |
| `debug_mode` is off. | Debug mode keeps every event for forensics, as every other reaper does. | {verified: SupersedingEventReaperSqlTests.Reap_DebugMode_KeepsEverythingAsync} |

| Choice | Reason | Verified |
|---|---|---|
| Superseded events are queued when the newer event is stored, and the reaper reads only the queue. | An idle database pays nothing: the reaper never scans the event store for candidates. Storing a superseding event costs one probe of a partial index that holds only keyed rows (`idx_event_store_superseding`); a batch with no superseding event skips it entirely. | {verified: SupersedingEventReaperSqlTests.Emit_Outbox_StampsTheKeyOnlyOnASupersedingEvent_AndQueuesTheOlderOneAsync, SupersedingEventReaperSqlTests.Emit_TwoEventsOfOneKeyInOneBatch_QueueTheOlderAsync} |
| The queue is written after the batch is stored, so an older event stored in the same batch is queued too. | Two events of one key can arrive together; a probe in the same statement as the insert would not see the first. | {verified: SupersedingEventReaperSqlTests.Emit_TwoEventsOfOneKeyInOneBatch_QueueTheOlderAsync} |
| At most 5,000 queued events per pass, oldest queued first. | One pass never becomes one long delete; a backlog drains over passes in the order it was superseded. There is no setting in this first cut. | {verified: SupersedingEventReaperSqlTests.Reap_TakesAtMostTheBatchSize_OldestQueuedFirstAsync} |
| A queued event that something else already removed (a prefix truncate, an archive, a purge) is dropped from the queue. | The queue stays bounded by the events actually waiting. | {verified: SupersedingEventReaperSqlTests.Reap_AQueuedEventAlreadyGone_IsForgottenAsync} |
| The reaper takes the event store's per-stream locks for the streams it judges, in stream id order. | Nothing is appended to, truncated from or archived out of those streams while their events are judged and removed. | {verified: SupersedingEventReaperSqlTests.Reap_SupersededAndConsumed_IsDeletedWithItsBodyAndItsDigestContribution_TheNewestIsKeptAsync} |
| The task runs last in the maintenance pass and leaves the processed perspective work rows of what it deletes to the next pass's purge. | The maintenance pass visits the work tables once each in one canonical order; touching one again at the end would break that order. | {verified: SupersedingEventReaperSqlTests.Reap_SupersededAndConsumed_IsDeletedWithItsBodyAndItsDigestContribution_TheNewestIsKeptAsync} |

## Integrity digests {#integrity-digests}

A reaped event leaves the stream's integrity digest the way a prefix truncate's events do: its hashes are subtracted
from `wh_stream_digests` (an emptied bucket is dropped), the sealed epochs that covered it are refolded, and the origin
generation is bumped once per pass that removed folded history, so consumers reset their seals and re-verify instead
of reporting damage.

| Choice | Reason | Verified |
|---|---|---|
| The digest after a reap equals a fresh fold of the events left. | Integrity checks compare digests; a reap is a deliberate change, not drift. | {verified: SupersedingEventReaperSqlTests.Reap_SupersededAndConsumed_IsDeletedWithItsBodyAndItsDigestContribution_TheNewestIsKeptAsync} |
| The origin generation is bumped once per pass, however many events it removed, and not at all when it removed only events no fold counts (at-most-once events, audit records). | Each bump makes consumers re-verify from the origin's epochs; a pass that changed no folded history must not cost them that. | {verified: SupersedingEventReaperSqlTests.Reap_RemovingFoldedHistory_RefoldsAndBumpsTheGenerationOnce_AnAtMostOnceEventDoesNotAsync} |

## Across services {#across-services}

A service that receives a superseding event stores it with the same flag and key its producer used: the flag comes from
the receiving service's message catalog by type name, and the key from the received payload read as its registered
type. Each service reaps its own copies by its own gates, so the producer and a subscriber can disagree about a stream's
digest for a while, until both have reaped the same events. That window is accepted: reaping never waits for a
subscriber to acknowledge.

{verified: ReceivedInboxMessageBuilderSupersedingKeyTests.Build_AReceivedSupersedingEvent_IsFlaggedAndKeyed_AnOrdinaryEventIsNotAsync, SupersedingEventReaperSqlTests.Emit_Inbox_StampsTheKey_AndQueuesTheOlderOneAsync}

| Choice | Reason | Verified |
|---|---|---|
| A received payload of a superseding type with a key property is deserialized once, with the service's `JsonSerializerOptions` (or the combined registered contexts when none is registered), so the generated accessor can read the key. | The producer's accessor and the receiver's are the same code, so both store the same key; reading JSON property names directly would depend on the naming policy. Only superseding types with a key pay for it. | {verified: SupersedingEventsTests.KeyOf_AReceivedJsonPayload_IsReadThroughItsTypeName_AsTheTypedPayloadIsAsync, ReceivedInboxMessageBuilderSupersedingKeyTests.Build_WithNoOptionsGiven_ReadsTheKeyThroughTheRegisteredContextsAsync} |

## Build rules {#build-rules}

| Diagnostic | Severity | When |
|---|---|---|
| [WHIZ135](../../operations/diagnostics/whiz135.md) | Error | An event type is both `[Ephemeral]` and `[Superseding]`. |
| [WHIZ136](../../operations/diagnostics/whiz136.md) | Error | A superseding event type marks more than one `[SupersedingKey]`. |

| Choice | Reason | Verified |
|---|---|---|
| A type either rule refuses is not registered as superseding, even when the error is suppressed. | The generator cannot tell which key was meant, or whether the type belongs to the ephemeral reaper; keeping every event is the recoverable direction. | {verified: MessageTypeCatalogGeneratorTests.Generator_ASupersedingTypeAnAnalyzerRefuses_IsNotRegistered_SoEveryEventIsKeptAsync} |

## Limits {#limits}

- **An archived and restored event loses its key.** The archive stores (`wh_event_archive` and the Azure Blob objects)
  do not carry `supersede_key`, so an event restored from an archive is never superseded. It is kept, which is the
  recoverable direction.
- **The key property must be readable by generated code** in the event's assembly (public or internal).
- **Events stored before the type was declared superseding** carry no key and are never reaped.

## Related

- [Event Store](./event-store.md)
- [Ephemeral Events](./ephemeral-events.md), for events that are deleted once consumed and never kept in the log
- [Stream End of Life](./stream-end-of-life.md)
- [Archive Store](./archive-store.md)
- [Stream integrity](../../resilience/stream-integrity.md)
