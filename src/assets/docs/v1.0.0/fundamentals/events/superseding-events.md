---
title: Superseding Events
pageType: concept
description: >-
  Declare an event type [Superseding] when every event holds the whole state for its key: once a newer event of the
  same type and key is stored on the stream, the older one is deleted with its body and its digest contribution after
  every consumer has processed it. Covers the key, the reaper and its gates, what it means for rebuilds and rewinds,
  integrity digests, received copies, the history stored before a type was declared superseding, and the WHIZ135 and
  WHIZ136 build rules.
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
  - src/Whizbang.Core/Configuration/SupersedingOptions.cs
  - src/Whizbang.Data.Postgres/SupersedingHistoryReconcileStep.cs
  - src/Whizbang.Data.Postgres/Migrations/345_SupersedingHistoryReconcile.sql
  - src/Whizbang.Data.Postgres/Migrations/358_StreamsRememberWhenTheyStarted.sql
  - src/Whizbang.Core/Perspectives/PerspectiveRowStart.cs
  - src/Whizbang.Data.Postgres/StreamStartSql.cs
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
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SupersedingHistoryReconcileSqlTests.cs
  - tests/Whizbang.Generators.Tests/MessageTypeCatalogFingerprintTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRowStartTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamStartedAtSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/RebuildCreatedAtIntegrationTests.cs
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
stream, of the same type (or the same [superseding group](#superseding-groups)), with the same key.

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

### A key missing from the payload {#a-key-missing-from-the-payload}

When a received message or a stored event is read from JSON, the key is taken from the payload. If the payload does
not carry the key property at all, or carries it as `null`, the event has **no key**: it is still marked superseding,
but it is never superseded and never supersedes another, so it is never reaped.

This matters for a key of a value type such as `Guid` or `int`. Reading the payload as the event type would turn an
absent key into the type's default (`00000000-0000-0000-0000-000000000000`, `0`), so every such event on a stream would
share one key and all but the newest would be deleted. It happens in two places:

- **History stored before the key property existed.** The [history reconcile](#history-stored-before-the-declaration)
  stamps those events without a key and logs each one at Information ("has no superseding key in its payload"). They
  are kept.
- **A rolling deploy.** A message from an older producer that lacks the key is stored on the receiver without a key,
  and kept.

To bring such events under the superseding rule, give them a key first (for example with an upcaster). Until then they
are kept.

{verified: SupersedingEventsTests.KeyOf_AValueTypeKeyMissingFromTheJson_IsNull_ButAPresentDefaultIsAKeyAsync, ReceivedInboxMessageBuilderSupersedingKeyTests.Build_AReceivedEventMissingItsValueTypeKey_IsFlaggedButUnkeyed_APresentDefaultIsAKeyAsync, SupersedingHistoryReconcileSqlTests.Reconcile_AValueTypeKeyMissingFromThePayload_IsStampedUnkeyed_KeptAndLogged_APresentDefaultIsAKeyAsync, DapperSupersedingKeyTests.HistoryMissingAValueTypeKey_IsReconciledUnkeyed_AndNoneIsReapedAsync}

| Choice | Reason | Verified |
|---|---|---|
| Absence decides, not the value. A key that is present is a real key even when it equals the type's default: two events that both carry `RegionId = Guid.Empty` supersede each other. | Only the payload knows whether the key was written. A default value can be a legitimate key; a missing one is unknown, and deleting history on an unknown key cannot be undone. | {verified: SupersedingEventsTests.KeyOf_AValueTypeKeyMissingFromTheJson_IsNull_ButAPresentDefaultIsAKeyAsync, ReceivedInboxMessageBuilderSupersedingKeyTests.Build_AReceivedEventMissingItsValueTypeKey_IsFlaggedButUnkeyed_APresentDefaultIsAKeyAsync} |
| The check applies only to payloads read from JSON (receive and history). A typed event dispatched in process is unchanged. | A typed event always has its key property, so its value, default or not, was set by the code that raised it. | {verified: DispatcherSupersedingKeyTests.PublishAsync_ASupersedingEvent_CarriesTheFlagAndItsKey_AnOrdinaryEventNeitherAsync} |
| The key is looked for under the name the serializer writes: its `[JsonPropertyName]`, or the naming policy's name, matched case-insensitively when the serializer options are (the framework's are). | A check under the wrong name would call every key missing and stop reclaiming anything. | {verified: SupersedingEventsTests.KeyOf_AKeyWithAJsonPropertyName_IsLookedForUnderThatNameAsync, SupersedingEventsTests.KeyOf_AContractWithAttributeProviders_HonorsItsNamingPolicyAsync} |
| A nullable key behaves the same way: missing or `null` means no key. | One rule for every key type. | {verified: SupersedingEventsTests.KeyOf_ANullableKey_IsNullWhenMissingOrNull_AndItsValueWhenPresentAsync} |
| The history reconcile logs a missing key at Information, the receive path does not log it. | Old history without the key is expected and can number in the thousands; the event is kept either way, so neither is a warning. | {verified: SupersedingHistoryReconcileSqlTests.Reconcile_AValueTypeKeyMissingFromThePayload_IsStampedUnkeyed_KeptAndLogged_APresentDefaultIsAKeyAsync} |
| Code generated before this change (no registered key name) reads the payload as before. Rebuild against the current generator to get the check. | Older generated registrations carry only the key accessor, not the key's JSON name. | {verified: SupersedingEventsTests.KeyOf_ARegistrationWithoutAMappableKeyMember_ReadsThePayloadAsBeforeAsync} |

## Superseding groups {#superseding-groups}

Without a group, superseding works per stream, event type and key: a stream keeps the newest event of each superseding
type. When several types each carry the whole state of the same thing (a created and an updated event that both hold the
full value), put them in one **superseding group**:

```csharp{title="Two event types in one superseding group" description="The newest of either type replaces the older events of both." framework="NET10" category="Events" difficulty="INTERMEDIATE" tags=["superseding", "groups"] tests=["SupersedingGroupSqlTests.Emit_ANewerEventOfAnotherTypeInTheGroup_QueuesTheOlder_InEitherOrderAsync"]}
[Superseding(Group = "document-embedding")]
public sealed record DocumentEmbeddingCreated([property: StreamId] Guid DocumentId, float[] Vector) : IEvent;

[Superseding(Group = "document-embedding")]
public sealed record DocumentEmbeddingUpdated([property: StreamId] Guid DocumentId, float[] Vector) : IEvent;
```

The newest event of **any** type in the group supersedes the older events of **every** type in it, per stream, group and
key. The created event is reaped once a later updated event exists and every consumer has processed it.

{verified: SupersedingGroupSqlTests.Emit_ANewerEventOfAnotherTypeInTheGroup_QueuesTheOlder_InEitherOrderAsync, SupersedingGroupSqlTests.Reap_AnEventSupersededByAnotherTypeOfItsGroup_IsDeleted_TheNewestIsKeptAsync, DapperSupersedingKeyTests.AppendAsync_GroupedTypes_SupersedeEachOther_AndTheOlderIsReapedAsync}

**Full state across types.** The [full-state rule](#full-state-payloads-only) now applies across the group. Every event
of every type in the group must carry everything a consumer needs for its key, because only the newest event of the
group is kept, whatever its type. A perspective or receptor that handles several types of a group must produce the same
state from whichever of them is newest, and must not depend on having seen the created event before an updated one:
after the reaper runs, a rebuild or rewind replays only the newest event of the group.

| Choice | Reason | Verified |
|---|---|---|
| The group is an explicit string, global, never derived from a type name. Types in different assemblies with the same name are in one group. An empty name means no group. | The group is stored with every event (`wh_event_store.supersede_group`, metadata `sg`), so renaming a class must not move its events to another group. | {verified: SupersedingEventsTests.GroupOf_AGroupedType_IsItsDeclaredGroup_AnUngroupedOrUnregisteredTypeHasNoneAsync, MessageTypeCatalogGeneratorTests.Generator_SupersedingEvent_StampsTheEntryAndRegistersTheKeyAsync} |
| Every write path stamps the group: the dispatcher's outbox row, a received inbox row, and a direct append on both drivers. | One group, whatever path stored the event, the same as the key. | {verified: DispatcherSupersedingKeyTests.PublishAsync_AGroupedSupersedingEvent_CarriesItsGroup_AnUngroupedOneNoneAsync, ReceivedInboxMessageBuilderSupersedingKeyTests.Build_AReceivedGroupedEvent_CarriesItsGroup_AnUngroupedOneNoneAsync, SupersedingGroupSqlTests.Emit_Inbox_StampsTheGroup_AndQueuesAcrossTypesAsync, SupersedingGroupSqlTests.DirectAppend_StampsTheGroup_AndQueuesAcrossTypesAsync} |
| A type without a group is its own group, exactly as before: two ungrouped types never supersede each other, and a grouped type never supersedes an ungrouped one or a type in another group. Events stored before groups existed need no migration. | Matching is on the group, falling back to the event type, so existing behavior and existing rows are unchanged. | {verified: SupersedingGroupSqlTests.Emit_UngroupedTypes_StillSupersedeOnlyTheirOwnTypeAsync, SupersedingGroupSqlTests.Emit_AGroupedAndAnUngroupedType_NeverSupersedeEachOtherAsync, SupersedingGroupSqlTests.Reap_AQueuedEventWhoseOnlyNewerEventIsOutsideItsGroup_IsKeptAsync} |
| Keys still divide a group, and every type in a group must have no `[SupersedingKey]` or a key of the same type ([WHIZ138](../../operations/diagnostics/whiz138)). A `Guid?` key agrees with a `Guid` key. | An event replaces only older events of the group with the same key, so the key must mean the same thing for every type. A nullable key and its value type are stored as the same text. | {verified: SupersedingGroupSqlTests.Emit_KeysStillPartitionAGroupAsync, SupersedingEventAnalyzerTests.AGroupWhoseTypesDisagreeOnTheKey_ReportsWHIZ138OnEachAsync, SupersedingEventAnalyzerTests.AGroupWhoseTypesAgree_OrTypesOutsideAnyGroup_NoWHIZ138Async} |
| An event whose key is [missing or null](#a-key-missing-from-the-payload) is never superseded, in a group or not. | A group never widens what an unknown key can delete. | {verified: SupersedingGroupSqlTests.Emit_AMissingKeyInAGroup_IsNeverSupersededAsync} |
| When a type joins, leaves or changes a group, the [history reconcile](#history-stored-before-the-declaration) walks the type's stored events again and stamps them with the new group, so older events of the group from either type are queued and reaped behind the newest. | The walk records its group; a different group restarts it. This does not depend on the type-definition registry. | {verified: SupersedingGroupSqlTests.Reconcile_TypesThatJoinAGroupLater_AreReStamped_AndTheOlderEventOfTheGroupIsReapedAsync, SupersedingGroupSqlTests.Reconcile_HistoryStoredBeforeAGroupedTypeWasSuperseding_IsStampedWithItsGroupAsync, SupersedingGroupSqlTests.Ensure_AChangedGroup_RestartsTheWalk_TheSameGroupDoesNotAsync} |
| The group lookup is served by an index on `(stream_id, COALESCE(supersede_group, event_type), supersede_key, version)` for keyed rows. | The queue and the reaper probe for a newer event of the same group on every superseding write and reap. | {verified: SupersedingGroupSqlTests.TheGroupProbe_IsServedByTheGroupIndexAsync} |

**Limits.** WHIZ138 checks the types of one compilation; types in other assemblies that share a group name are not
compared. A group named exactly like an ungrouped type's stored type name (`"Ns.Type, Assembly"`) would match that type,
so do not use a type name as a group name.

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

## History stored before the declaration {#history-stored-before-the-declaration}

The write paths stamp the flag and the key when an event is stored, so the events a type stored before it was declared
`[Superseding]` carry neither, and no newer event ever queues them. Maintenance brings them under the same rule: the
`superseding-history-reconcile` step walks each superseding type's stored events, reads each event's key from its stored
payload with the generated accessor the write paths use, stamps the flag and the key, and queues every event but the
newest of each stream, type and key. From there the [reaper](#the-reaper) takes over: an old event is deleted only past
every one of its gates, and the digests are adjusted as for any other reaped event. The step itself deletes nothing.

{verified: SupersedingHistoryReconcileSqlTests.Reconcile_HistoryStoredBeforeTheDeclaration_IsReapedDownToTheNewestOfEachKey_OnceConsumedAsync, DapperSupersedingKeyTests.HistoryStoredBeforeTheDeclaration_IsReconciledByTheRegisteredStep_AndReapedToTheNewestAsync}

It is on by default. Set `Whizbang:Superseding:ReconcileHistory` to `false` to keep the history as it was stored
([configuration](../../operations/configuration/configuration-reference#superseding-options)).

```json{
title: "Keeping the history stored before the declaration"
description: "Turns the history reconcile off; events stored after the declaration are still superseded as usual."
framework: "NET10"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["superseding", "configuration", "maintenance"]
tests: ["ProcessWideOptionsBindingTests.Superseding_Unconfigured_ReconcilesHistory_AndTheKeyTurnsItOffAsync"]
}
{
  "Whizbang": {
    "Superseding": {
      "ReconcileHistory": false
    }
  }
}
```

| Choice | Reason | Verified |
|---|---|---|
| On by default: a type that becomes superseding has its earlier history reconciled with no setting. | The reconcile only stamps and queues; the reaper's gates (consumed, no cursor or snapshot on it, no destruction hold, stamped, not debug mode) stay the only path to deletion, so nothing goes that the reaper would not remove for an event stored after the declaration. Declaring the type superseding is the promise that its older events are redundant, and leaving them would keep the storage the declaration was meant to recover. | {verified: ProcessWideOptionsBindingTests.Superseding_Unconfigured_ReconcilesHistory_AndTheKeyTurnsItOffAsync, SupersedingHistoryReconcileSqlTests.Reconcile_OldEventsTheGatesProtect_StayAsync} |
| The key is read from the stored payload by the same generated accessor and invariant-text rules as on the write paths; a null key is stamped without a key, and a payload whose key cannot be read is kept and logged. | A historical event must be keyed exactly as the same event stored today, or it would supersede, or be superseded by, the wrong events. Keeping an event whose key is unknown is the recoverable direction. | {verified: SupersedingHistoryReconcileSqlTests.Reconcile_ANullKey_IsStampedUnkeyed_AndNeverQueued_AKeylessTypeKeepsOnePerStreamAsync, SupersedingHistoryReconcileSqlTests.Reconcile_AnUnreadablePayload_IsStampedUnkeyed_AndLoggedAsync} |
| An old event is queued whether it is stamped before or after the newer event of its key. | A newer event stored after the declaration was already keyed when the old one had no key, so it queued nothing; the old event queues itself when it is stamped. | {verified: SupersedingHistoryReconcileSqlTests.Reconcile_AnOldEventStampedAfterTheNewerOneOfItsKey_IsQueuedAsync} |
| A maintenance step, not startup work. | It runs only once the service has settled (or the deferral limit forces the cycle), only after the maintainer turn, and in bounded batches, like every other step that rewrites stored rows. | {verified: SupersedingHistoryReconcileSqlTests.ThePostgresDriver_RegistersTheStepAsync, DapperSupersedingKeyTests.HistoryStoredBeforeTheDeclaration_IsReconciledByTheRegisteredStep_AndReapedToTheNewestAsync} |
| The walk reads the event store by event id, 5,000 events per batch, each batch one transaction, at most 20 batches a cycle; a cursor per type (`wh_superseding_history`) lets the next cycle, or a restart after a crash, continue where the last committed batch stopped. | No index serves "the events of this type without the flag" without revisiting the stamped ones on every batch, and an index that did would be written by every append for the life of the store. The primary key reads each event once per walk, and a finished walk costs one row read per type per cycle. | {verified: SupersedingHistoryReconcileSqlTests.Reconcile_RunsInBoundedBatches_AndResumesFromItsCursor_AfterACrashAsync} |
| One instance per type: the type's cursor row is taken with `SKIP LOCKED`, and an event row another transaction holds is left for the next batch, which stops the cursor just before it. | Two instances never do the same work, and the walk never waits on a writer or the reaper. | {verified: SupersedingHistoryReconcileSqlTests.Reconcile_WhileAnotherInstanceHoldsTheType_SkipsWithoutWaiting_AndDoesNoWorkAsync, SupersedingHistoryReconcileSqlTests.Reconcile_ARowAnotherTransactionHolds_IsLeftForTheNextBatch_WithoutWaitingAsync} |
| Stamping takes the per-stream locks the write paths take, in stream id order. | A newer event of the same key stored at the same moment is either seen by the stamp or sees it, so no old event is left unqueued. | {verified: SupersedingHistoryReconcileSqlTests.Reconcile_AnOldEventStampedAfterTheNewerOneOfItsKey_IsQueuedAsync} |
| A second run changes nothing. | A stamped event is never read again and a queued event is never queued twice. | {verified: SupersedingHistoryReconcileSqlTests.Reconcile_ASecondRun_ChangesNothingAsync} |
| Only the types registered as superseding are walked, and only their Sourced events. | A type that is not, or is no longer, superseding keeps every event; an ephemeral event belongs to the ephemeral reaper. | {verified: SupersedingHistoryReconcileSqlTests.Reconcile_ATypeThatIsNotSuperseding_IsNotTouchedAsync, SupersedingHistoryReconcileSqlTests.Reconcile_AnEphemeralEventOfTheType_IsLeftToTheEphemeralReaperAsync} |
| `[Superseding]` is part of a type's settings hash, and a walk starts again from the first event when the type-definition registry holds a newer definition of the type than the walk started under. | Becoming superseding is then recorded in the registry as a definition change, and a type that was briefly something else, and stored unflagged events meanwhile, is walked again. Every type that is not superseding keeps the hash it had. | {verified: MessageTypeCatalogFingerprintTests.SettingsHash_ChangesWhenATypeBecomesSuperseding_AndASourcedTypeKeepsItsHashAsync, SupersedingHistoryReconcileSqlTests.Reconcile_ANewerDefinitionOfTheType_WalksItAgainFromTheStartAsync} |
| Each service reconciles its own store. | A received copy is reaped by the receiver's own gates, as on the live path. | {verified: SupersedingHistoryReconcileSqlTests.Reconcile_ReceivedCopies_AreReconciledInTheReceivingStoreAsync} |

The step logs, per type and cycle, the events it stamped and queued and how many of the type's events are left to
read, and one line when a type's walk reaches the end of the store.

{verified: SupersedingHistoryReconcileSqlTests.Step_ReportsProgress_AndOneLineWhenATypeFinishesAsync}

## Build rules {#build-rules}

| Diagnostic | Severity | When |
|---|---|---|
| [WHIZ135](../../operations/diagnostics/whiz135.md) | Error | An event type is both `[Ephemeral]` and `[Superseding]`. |
| [WHIZ136](../../operations/diagnostics/whiz136.md) | Error | A superseding event type marks more than one `[SupersedingKey]`. |

| Choice | Reason | Verified |
|---|---|---|
| A type either rule refuses is not registered as superseding, even when the error is suppressed. | The generator cannot tell which key was meant, or whether the type belongs to the ephemeral reaper; keeping every event is the recoverable direction. | {verified: MessageTypeCatalogGeneratorTests.Generator_ASupersedingTypeAnAnalyzerRefuses_IsNotRegistered_SoEveryEventIsKeptAsync} |

## What a rebuild keeps {#what-a-rebuild-keeps}

A perspective row's `CreatedAt` is business time: the first event folded into the row. The runner folds a batch and
writes the row once, and the write's own time, the last folded event's, is `UpdatedAt`. A row inserted by a write that
folded several events is dated at the first of them, live or in a rebuild, so the value does not depend on batching. An
update never moves `CreatedAt`.

The reaper deletes an older event outright, the stream's first event included, so the store also remembers when each
stream started. When the reaper or a prefix truncate removes a stream's first event (version 0 or 1), it first records
that event's business time on the stream's ledger row (`wh_stream_lifecycle.first_event_at`). A row whose fold no longer
begins its stream is dated at that start. The row's data still comes from the surviving events.

| When | Event | Row `CreatedAt` |
|---|---|---|
| Mar 1 | v1 | Mar 1 |
| Jun 5 | v2 (same key) | Mar 1 |
| Jun 6 | reaper deletes v1, records Mar 1 | Mar 1 |
| Nov 8 | perspective rebuilt | Mar 1 |

| Choice | Reason | Verified |
|---|---|---|
| A row a write inserts is dated at the first event the write folded, not the write's own time (the last folded event's, which is `UpdatedAt`). | `CreatedAt` is when the entity came into being; dated at the last event of its first batch, it depended on how events were batched and moved on every blue-green rebuild. | {verified: PerspectiveRowStartTests.ResolveAsync_AFoldThatBeginsTheStream_IsTheFirstEventsTime_NotTheLastsAsync, RebuildCreatedAtIntegrationTests.RebuildBlueGreen_AFullHistoryStream_DatesTheRowAtItsFirstEvent_AndUpdatedAtAtItsLastAsync, RebuildCreatedAtIntegrationTests.RebuildInPlace_AFullHistoryStream_InsertsTheRowDatedAtItsFirstEventAsync, RebuildCreatedAtIntegrationTests.LiveFirstBatch_OfSeveralEvents_DatesTheRowAtTheFirstAsync} |
| The start is recorded when the first event is removed, not when it is appended. | No write path changes, so the append hot path pays nothing; only the reaper and the prefix truncate, both maintenance, do the extra write. | {verified: StreamStartedAtSqlTests.Reap_TheStreamsFirstEvent_RecordsItsBusinessTimeOnTheLedgerAsync, StreamStartedAtSqlTests.Reap_ALaterEvent_RecordsNothingAsync, StreamStartedAtSqlTests.Truncate_ThroughTheFirstEvent_RecordsItsBusinessTimeOnTheLedgerAsync} |
| It is the first event's business time, not `first_appended_at`. | `first_appended_at` is the database clock when the event was stored; an imported or replayed event carries a business time well before it. The value is cut to the microsecond as the driver cuts a .NET time, so it equals what the row would have held. | {verified: StreamStartedAtSqlTests.BusinessTime_IsTheLastStoredHopsTimestamp_CutToTheMicrosecondAsync, StreamStartedAtSqlTests.BusinessTime_WithNoHop_IsNullAsync} |
| A first event removed before this was recorded falls back to `first_appended_at`. | It is the closest start the ledger knows; the oldest surviving event is further from it. | {verified: StreamStartedAtSqlTests.StartedAt_AFirstEventRemovedWithNothingRecorded_IsTheFirstAppendAsync} |
| A stream that still holds its first event is dated by the first event its row folds; the ledger is not consulted. | The record exists only for a removed first event. | {verified: StreamStartedAtSqlTests.StartedAt_AStreamHoldingItsFirstEvent_IsNullAsync, RebuildCreatedAtIntegrationTests.RebuildBlueGreen_AFullHistoryStream_DatesTheRowAtItsFirstEvent_AndUpdatedAtAtItsLastAsync} |
| The store is asked only for a row that may be inserted and whose fold does not begin the stream. | An existing row keeps its `CreatedAt` on update, and a fold that holds the first event already dates the row; neither needs a round trip. | {verified: PerspectiveRowStartTests.ResolveAsync_ARowThatExists_AsksNothingAsync, RebuildCreatedAtIntegrationTests.RebuildInPlace_AnExistingRow_KeepsItsCreatedAtAsync} |
| The start dates only the row it was resolved for, and only its insert. | One rebuild flow writes many rows; another stream's start never dates this one, and an update never moves `CreatedAt`. | {verified: PerspectiveRowStartTests.Begin_DatesThatRowOnly_UntilTheHandleIsDisposedAsync, BitemporalWritePathTests.Insert_InAFlowDatingAnotherRow_IsDatedByItsEventAsync, BitemporalWritePathTests.Insert_InAFlowDatingTheRowAtItsStreamsStart_TakesThatStart_AndAnUpdateKeepsItAsync} |
| Blue-green and in-place rebuilds both apply it, after a reap and after a prefix truncate. | Both write the row through the same runner write. | {verified: RebuildCreatedAtIntegrationTests.RebuildBlueGreen_AfterTheFirstEventIsReaped_DatesTheRowAtTheStreamsStartAsync, RebuildCreatedAtIntegrationTests.RebuildInPlace_ARowItInserts_AfterTheFirstEventIsReaped_DatesTheRowAtTheStreamsStartAsync, RebuildCreatedAtIntegrationTests.RebuildBlueGreen_AfterAPrefixTruncate_DatesTheRowAtTheStreamsStartAsync} |
| An event with no hop carries no business time; a row whose first event has none keeps the write's own time. | The runner reads business time from the last hop, as for every event. | {verified: PerspectiveRowStartTests.ResolveAsync_AFirstEventWithNoHop_LeavesTheRowToTheWritesOwnTimeAsync} |

The start is the stream's, not the perspective's: once the first event is gone, a perspective that never folded that
event is dated at the stream's start too.

## Limits {#limits}

- **A row already stored keeps the date it was given.** Only a blue-green rebuild, which writes every row afresh,
  re-dates rows written before rows were dated at their first event. A row resurrected from a snapshot after eviction is
  dated at the first event after the snapshot.
- **A stream archived through a prefix** records no first-event time; a row rebuilt from its snapshot is dated at the
  time the stream's first event was stored.
- **An archived and restored event loses its key.** The archive stores (`wh_event_archive` and the Azure Blob objects)
  do not carry `supersede_key`, so an event restored from an archive is never superseded. It is kept, which is the
  recoverable direction.
- **The key property must be readable by generated code** in the event's assembly (public or internal).
- **An event stored by an instance that did not yet know the type is superseding, after the walk passed it** (for
  example, by a replica still running the earlier code during a rolling deploy) stays unflagged and is kept. It is never
  reaped wrongly, only kept. Deleting the type's row in `wh_superseding_history` walks the type again.
- **A key property added after events were stored** reads as the property's default from those events (`null` for a
  reference type, which keeps them, but the default value for a value type such as a `Guid`, which gives them all one
  key per stream).
- **Events stored under a former name of the type** are not walked: a newer event of the current name never supersedes
  them.

## Related

- [Event Store](./event-store.md)
- [Ephemeral Events](./ephemeral-events.md), for events that are deleted once consumed and never kept in the log
- [Stream End of Life](./stream-end-of-life.md)
- [Archive Store](./archive-store.md)
- [Stream integrity](../../resilience/stream-integrity.md)
