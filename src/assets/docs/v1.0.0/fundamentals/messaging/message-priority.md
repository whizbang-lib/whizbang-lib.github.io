---
title: Message Priority
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-09-09
order: 8
description: >-
  One integer on every message and three scheduling buckets. The producer
  declares from context, the consumer classifies at its receive boundary, a
  child inherits its parent's effective number, every seam that copies an
  envelope or a row carries the number across, a minted composite folds its
  members' numbers, and three hooks (producer, receive, batch) make every
  default replaceable.
tags: 'priority, work-class, interactive, background, hooks, inheritance, scheduling, composites, wire'
codeReferences:
  - src/Whizbang.Core/Priority/WorkPriority.cs
  - src/Whizbang.Core/Priority/PriorityHooks.cs
  - src/Whizbang.Core/Observability/MessageEnvelope.cs
  - src/Whizbang.Core/Observability/IMessageEnvelope.cs
  - src/Whizbang.Core/ServiceCollectionExtensions.cs
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Workers/ReceivedInboxMessageBuilder.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/149_MessagePriority.sql
  - src/Whizbang.Data.Postgres/Migrations/150_BucketAwareClaim.sql
  - src/Whizbang.Data.Schema/Schemas/InboxSchema.cs
  - src/Whizbang.Data.Schema/Schemas/OutboxSchema.cs
  - src/Whizbang.Data.Schema/Schemas/PerspectiveEventsSchema.cs
  - src/Whizbang.Core/Messaging/WorkCoordinatorGate.cs
  - src/Whizbang.Core/Messaging/WorkCoordinatorGateOptions.cs
  - src/Whizbang.Core/Priority/PriorityOptions.cs
  - src/Whizbang.Core/Priority/PrioritySugarHooks.cs
  - src/Whizbang.Core/Tags/TagOptions.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/ClaimedInboxStreamFolder.cs
  - src/Whizbang.Core/Priority/IPrioritized.cs
  - src/Whizbang.Core/Dispatch/DispatchOptions.cs
  - src/Whizbang.Core/Observability/MessageEnvelopeExtensions.cs
  - src/Whizbang.Core/Messaging/EnvelopeSerializer.cs
  - src/Whizbang.Core/Serialization/JsonContextRegistry.cs
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
  - src/Whizbang.Core/Workers/OutboxDrainWorker.cs
  - src/Whizbang.Core/Workers/InboxDrainWorker.cs
  - src/Whizbang.Core/Offloads/BodyOffloadPostSerializeHook.cs
  - src/Whizbang.Core/Messaging/CompositeInboxFanout.cs
  - src/Whizbang.Core/Workers/CoalesceShipWorker.cs
  - src/Whizbang.Core/Tags/CoalescePolicyOptions.cs
  - src/Whizbang.Core/Tags/CompositePriorityFold.cs
  - src/Whizbang.Core/SystemEvents/AuditOutboxMessageBuilder.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/151_PriorityOnTheWire.sql
  - src/Whizbang.Data.Postgres/Migrations/constants.txt
  - src/Whizbang.Core/SystemEvents/AuditingEventStoreDecorator.cs
  - src/Whizbang.Core/SystemEvents/SystemEventEmitter.cs
  - src/Whizbang.Core/Workers/IntegrityCheckpointWorker.cs
  - src/Whizbang.Core/Workers/IntegrityAuditWorker.cs
  - src/Whizbang.Core/Workers/RepairDrainWorker.cs
  - src/Whizbang.Core/Workers/SubscriptionExpansionWorker.cs
  - src/Whizbang.Core/Messaging/RedeliveryPump.cs
  - src/Whizbang.Data.EFCore.Postgres/IntegrityCheckpointReceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/IntegrityManifestReceptors.cs
  - src/Whizbang.Core/Transports/DispatcherTransportBridge.cs
  - src/Whizbang.Core/Transports/TransportManager.cs
  - src/Whizbang.Core/Messaging/SecurityContextEventStoreDecorator.cs
  - src/Whizbang.Core/Messaging/InMemoryEventStore.cs
  - src/Whizbang.Data.Dapper.Postgres/EventEnvelopeJsonbAdapter.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperPostgresEventStore.cs
  - src/Whizbang.Data.Dapper.Sqlite/DapperSqliteEventStore.cs
testReferences:
  - tests/Whizbang.Core.Tests/Priority/WorkPriorityTests.cs
  - tests/Whizbang.Core.Tests/Priority/PriorityHooksTests.cs
  - tests/Whizbang.Core.Tests/Priority/DispatcherPriorityStampingTests.cs
  - tests/Whizbang.Core.Tests/Priority/ConsumerPriorityClassificationTests.cs
  - tests/Whizbang.Core.Tests/Priority/InboxDispatchWorkerPriorityContextTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MessagePrioritySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/BucketAwareClaimSqlTests.cs
  - tests/Whizbang.Data.Schema.Tests/Schemas/PriorityColumnTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorGateInteractiveReserveTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorGateRegistrationTests.cs
  - tests/Whizbang.Core.Tests/Priority/PriorityTagSurfaceTests.cs
  - tests/Whizbang.Core.Tests/Priority/ClaimWorkerPriorityBatchHookTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EnvelopeSerializerTests.cs
  - tests/Whizbang.Core.Tests/Observability/MessageEnvelopeExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Offloads/BodyOffloadPostSerializeHookTests.cs
  - tests/Whizbang.Core.Tests/Messaging/CompositeInboxFanoutTests.cs
  - tests/Whizbang.Core.Tests/JsonContextRegistryTests.cs
  - tests/Whizbang.Generators.Tests/MessageJsonContextGeneratorTests.cs
  - tests/Whizbang.Core.Tests/Workers/OutboxDrainWorkerGapTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDrainWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/CoalesceShipWorkerTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditOutboxMessageBuilderCoverageTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PriorityOnTheWireSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ClaimedInboxStreamFolderTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperWorkCoordinatorWithDataTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditingEventStoreDecoratorPriorityTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/SystemEventEmitterPriorityTests.cs
  - tests/Whizbang.Core.Tests/Workers/IntegrityCheckpointWorkerPriorityTests.cs
  - tests/Whizbang.Core.Tests/Workers/IntegrityAuditWorkerPriorityTests.cs
  - tests/Whizbang.Core.Tests/Workers/RepairDrainWorkerPriorityTests.cs
  - tests/Whizbang.Core.Tests/Workers/SubscriptionExpansionWorkerPriorityTests.cs
  - tests/Whizbang.Core.Tests/Messaging/RedeliveryPumpPriorityTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityReceptorsPriorityTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/IntegrityManifestReceptorTests.cs
  - tests/Whizbang.Transports.Tests/DispatcherTransportBridgePriorityTests.cs
  - tests/Whizbang.Transports.Tests/TransportManagerPriorityTests.cs
  - tests/Whizbang.Core.Tests/Messaging/SecurityContextEventStoreDecoratorPriorityTests.cs
  - tests/Whizbang.Core.Tests/Messaging/InMemoryEventStorePriorityTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/EventEnvelopeJsonbAdapterPriorityTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperPostgresEventStorePriorityTests.cs
  - tests/Whizbang.Data.Tests/DapperSqliteEventStorePriorityTests.cs
  - tests/Whizbang.Core.Tests/Priority/PriorityOnTheWireEndToEndTests.cs
---

# Message Priority

Contention latency is the time an interactive message waits behind work nobody is waiting for. A
bulk import fans in tens of thousands of events per minute; a user's command arrives in the same
inbox, is claimed by the same loop, and waits its turn. Priority is how the framework tells the two
apart and schedules them differently, without breaking the one rule that is not negotiable: rows of
one stream are processed in order.

This page is the released design. The decisions it records were settled in review and are listed
at the end.

## The number and the bucket {#the-number-and-the-bucket}

{verified: WorkPriorityTests.Constants_SitMidBandAsync, WorkPriorityTests.Bucket_MapsTheBandsAsync, WorkPriorityTests.Bucket_TreatsUndeclaredAsStandardAsync, WorkPriorityTests.Effective_ReplacesUndeclaredWithStandard_AndKeepsADeclaredNumberAsync, WorkPriorityTests.IsDeclared_IsTrueOnlyForAPositiveNumberAsync}

Priority is **one integer on every message, lower is more urgent**. Producers, consumers,
inheritance and aging all work in one integer space, so an override is arithmetic and "a little more
urgent than an ordinary interactive message" is a smaller number. The named constants sit in the
middle of their band, so a declaration can move in either direction without changing bucket:

| constant | value | band | meaning |
|---|---|---|---|
| `WorkPriority.UNDECLARED` | `0` | none | nothing declared; read as `STANDARD` wherever an effective number is needed |
| `WorkPriority.INTERACTIVE` | `50` | `1` to `99` | a person or a synchronous caller is waiting |
| `WorkPriority.STANDARD` | `150` | `100` to `199` | domain work with no one waiting |
| `WorkPriority.BACKGROUND` | `250` | `200` and up | work that exists because of volume or maintenance |

**The bucket is the scheduling class.** `WorkPriority.Bucket(n)` maps a number onto `WorkBucket`
(`Interactive`, `Standard`, `Background`), and everything that needs a bounded set of queues works
on the bucket: fair queuing needs a handful of queues with weights, and three is the smallest set
that can still say "no one is waiting, but it is not bulk". Inside a bucket the number orders
streams.

Zero is reserved for "not declared". It costs nothing on the wire, and `WorkPriority.Effective(0)`
reads it as `STANDARD`, so nothing a producer leaves unset can land in the urgent bucket. A negative
number is treated the same way.

The number travels on the envelope as one small field, `pri`, omitted when undeclared: {verified: PriorityHooksTests.Envelope_CarriesTheDeclaredPriorityUnderAShortKey_AndOmitsItWhenUndeclaredAsync}

## Declaration and classification {#declaration}

Two decisions, kept distinct on purpose:

| | who sets it | where it lives | who reads it |
|---|---|---|---|
| **declared priority** | the producer, from dispatch context or the producer hook | the envelope, one integer | the consumer's receive hook |
| **effective priority** | the consumer, at its receive boundary | the consumer's own row | the claim, the batch hook, the drain, the meters |

**The producer knows the origin.** The framework's producer default,
`ContextPriorityProducerHook`, derives the declared number from context the dispatcher already has:

- An application-initiated dispatch (no handler on the dispatch context) is `INTERACTIVE`: a caller
  is waiting at a boundary.
- Scheduled work is `BACKGROUND`.
- Everything else, which is work a handler emits, is `STANDARD`.
- **Inheritance.** A message produced while handling another inherits the parent's effective number,
  and inheritance never raises above the parent: a message produced while handling background work
  is background whatever its type normally is. Only an explicit declaration raises it, and that is
  kept.

{verified: PriorityHooksTests.ProducerDefault_AnApplicationInitiatedDispatch_IsInteractiveAsync, PriorityHooksTests.ProducerDefault_ADispatchInsideAHandler_IsStandardAsync, PriorityHooksTests.ProducerDefault_ScheduledWork_IsBackgroundAsync, PriorityHooksTests.ProducerDefault_AChildInheritsItsParentsEffectiveNumberAsync, PriorityHooksTests.ProducerDefault_InheritanceNeverRaisesAboveTheParentAsync, PriorityHooksTests.ProducerDefault_KeepsAnExplicitDeclarationAsync}

**The consumer knows its own role.** The framework's receive default,
`AcceptDeclaredPriorityReceiveHook`, accepts the declared number and reads an undeclared one as
`STANDARD`. A consumer may lower or raise by its own rule; both are allowed and both numbers are
kept. The domain-owning service therefore processes its own interactive messages first, while a
secondary consumer of the same messages may treat them as background. Classification is positive: a
rule that does not match leaves the declared number in place, and a lookup miss never lands a message
in the urgent bucket. {verified: PriorityHooksTests.ReceiveDefault_AcceptsTheDeclaredNumber_AndReadsUndeclaredAsStandardAsync}

### Where the two decisions run

{verified: DispatcherPriorityStampingTests.Send_OutsideAnyHandling_DeclaresInteractive_OnTheEnvelopeAndTheRowAsync, DispatcherPriorityStampingTests.Send_WhileHandlingBackgroundWork_InheritsBackgroundAsync, DispatcherPriorityStampingTests.Send_WithAHostProducerHook_UsesItsDeclarationAsync, DispatcherPriorityStampingTests.Send_WithNoChainRegistered_LeavesTheEnvelopeUndeclaredAsync, ConsumerPriorityClassificationTests.Receive_StoresTheDeclaredNumber_WhenTheDefaultChainAcceptsItAsync, ConsumerPriorityClassificationTests.Receive_ReadsAnUndeclaredNumberAsStandardAsync, ConsumerPriorityClassificationTests.Receive_AHostReceiveHook_LowersTheNumber_AndTheRowCarriesItsAnswerAsync, ConsumerPriorityClassificationTests.Receive_WithNoChainRegistered_StoresTheDeclaredNumbersEffectiveValueAsync}

- **The dispatcher declares.** Every message it sends to the outbox goes through the producer hooks
  with the dispatch context, the schedule, the ambient parent and whatever the envelope already
  carries. The answer lands on the envelope, so it travels, and on the outbox row, so the store keeps
  it. A host that never registered the chain sends undeclared envelopes exactly as before.
- **The consumer classifies.** Both consumer workers (the transport consumer and the Service Bus
  consumer) run the receive hooks before the row is stored and write the answer to the inbox row.
  Without a chain the row carries the declared number's effective value, so nothing is ever stored
  as zero.
- **The dispatch worker enters the row's number** as the ambient parent for the whole handling, so
  every lifecycle stage and everything a receptor dispatches from inside one inherits it.
  {verified: InboxDispatchWorkerPriorityContextTests.Dispatch_EntersTheRowsPriorityAsTheAmbientParent_ForEveryStageAsync}

### Declaring with tags and classifying by rule {#declaring-with-tags}

{verified: PriorityTagSurfaceTests.DeclarePriority_ForATag_DeclaresEveryMessageCarryingItAsync, PriorityTagSurfaceTests.DeclarePriority_KeepsAnEarlierExplicitDeclarationAsync, PriorityTagSurfaceTests.DeclarePriority_LastBindingPerTagWinsAsync, PriorityTagSurfaceTests.ClassifyNamespace_LowersEverythingInTheNamespace_AndLeavesTheRestAsync, PriorityTagSurfaceTests.ClassifyType_RaisesOneType_AndTheMostSpecificRuleWinsAsync, PriorityTagSurfaceTests.Classify_ARule_DecidesByContent_AndNullKeepsTheDeclaredNumberAsync, PriorityTagSurfaceTests.AddWhizbangPriority_RegistersTheSugarHooksAheadOfTheDefaultsAsync}

The common cases need no hook of their own. A producer declares through the tag surface that already
binds coalescing and namespace routing, and a consumer classifies through the priority options; both
are ordinary hooks registered ahead of the framework defaults (Order 500), so the defaults keep what
the sugar declared.

```csharp{
title: "Declaring a priority for a producer's tagged message types"
description: "Tags classify; binding a number to a tag declares every message type that carries it, whatever context it is dispatched from. Last binding per tag wins, like the other tag bindings."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["priority", "tags", "producer", "configuration"]
tests: ["PriorityTagSurfaceTests.DeclarePriority_ForATag_DeclaresEveryMessageCarryingItAsync", "PriorityTagSurfaceTests.DeclarePriority_LastBindingPerTagWinsAsync"]
}
services.AddWhizbang(options => {
  options.Tags.DeclarePriority("bulk-import", WorkPriority.BACKGROUND);
  options.Tags.DeclarePriority("user-session", WorkPriority.INTERACTIVE);
  // A number anywhere in a band is valid: more urgent than an ordinary interactive message, same bucket.
  options.Tags.DeclarePriority("permission-revoked", WorkPriority.INTERACTIVE - 40);
});
```

```csharp{
title: "A consumer's classification rules"
description: "Rules by namespace, by type, or by a predicate over the receive context decide the effective priority; a rule that does not match has no opinion, and the most specific rule wins (type over namespace over predicate)."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["priority", "classification", "consumer", "configuration"]
tests: ["PriorityTagSurfaceTests.ClassifyNamespace_LowersEverythingInTheNamespace_AndLeavesTheRestAsync", "PriorityTagSurfaceTests.ClassifyType_RaisesOneType_AndTheMostSpecificRuleWinsAsync", "PriorityTagSurfaceTests.Classify_ARule_DecidesByContent_AndNullKeepsTheDeclaredNumberAsync"]
}
services.AddWhizbang(options => {
  // Everything from the job domain is background for this service, whatever the producer said.
  options.Priority.ClassifyNamespace("Contracts.Job", WorkPriority.BACKGROUND);

  // A consumer may raise or lower by declared policy; both are recorded. Never by inheritance.
  options.Priority.ClassifyType<PermissionRevokedEvent>(WorkPriority.INTERACTIVE);

  // Content-dependent: a rule over the receive context; null keeps the declared number.
  options.Priority.Classify(ctx =>
    ctx.MessageTypeName.StartsWith("Contracts.Job.Import", StringComparison.Ordinal) ? WorkPriority.BACKGROUND : null);
});
```

The classification rules live on `options.Priority` rather than on the routing options the design
sketched: classification is a scheduling decision, not a topology one, and the routing options are
not part of the core configuration root.

## Storage {#storage}

{verified: PriorityColumnTests.Inbox_PriorityColumn_IsIntegerNotNullDefaultStandardAsync, PriorityColumnTests.AllThreeTables_PriorityColumn_SharesTheSameNameAsync, MessagePrioritySqlTests.StoreInboxMessages_WritesTheEffectivePriority_AndReadsUndeclaredAsStandardAsync, MessagePrioritySqlTests.StoreOutboxMessages_WritesTheDeclaredPriority_AndReadsUndeclaredAsStandardAsync, MessagePrioritySqlTests.FetchInboxBatch_ReturnsTheRowsPriorityAsync, MessagePrioritySqlTests.ClaimWork_PerspectiveWorkCreatedFromAClaimedInboxEvent_InheritsTheEventRowsPriorityAsync}

Migration `149_MessagePriority.sql` adds `priority INTEGER NOT NULL DEFAULT 150` to `wh_inbox`,
`wh_outbox` and `wh_perspective_events`. The store functions read the message's `Priority` and write
it to the row, and an undeclared (zero) number lands in the standard band, so a row is never stored as
zero and a caller that predates the column behaves as before. The inbox fetch returns the number with
each row, and the perspective work created when a claimed inbox event (or a committed outbox event) is
copied into the event store inherits the source row's number, so an interactive event's projection is
not queued as standard behind bulk projections.

The effective number gets its own column because it is a per-consumer decision, not a property of
the message, and because the claim orders by it. The meters report the bucket everywhere and the raw
number only in traces, so a dashboard says "Interactive", not "137".

## On the wire {#on-the-wire}

{verified: OutboxDrainWorkerGapTests.OutboxDrainWorker_PublishesTheRowsPriorityOnTheWireAsync, OutboxDrainWorkerGapTests.OutboxDrainWorker_WithoutARowNumber_KeepsTheStoredEnvelopesPriorityAsync, MessagePrioritySqlTests.FetchOutboxBatch_ReturnsTheRowsPriorityAsync, DapperWorkCoordinatorWithDataTests.FetchOutboxBatchAsync_ReturnsTheRowsPriorityAsync, DapperWorkCoordinatorWithDataTests.FetchInboxBatchAsync_ReturnsTheRowsPriorityAsync, InboxDrainWorkerTests.InboxDrainWorker_StampsTheRowsPriorityOnTheEnvelopeAsync}

A declaration is only worth what survives the trip. The number is stored on the producer's row and
inside the stored envelope, but between that row and the consumer's row the framework copies the
envelope several times, and each copy is a place the number can be lost. The rule is therefore
stated once and enforced seam by seam: **any code that constructs or copies an envelope or a work
row either copies the number from its source or declares a band with a reason, and ships with a test
asserting the number on the far side.**

The seams, in the order a message crosses them:

| seam | what carries the number | rule |
|---|---|---|
| the outbox fetch | `fetch_outbox_batch` returns the row's `priority` (migration `151_PriorityOnTheWire.sql`); the EF and Dapper readers map it | a fetch that predates the column leaves the row undeclared |
| the outbox drain | `OutboxDrainWorker` rebuilds the wire envelope with the row's number, falling back to the stored envelope's (`WorkPriority.FirstDeclared`) | the row is authoritative once it exists |
| the typed envelope metadata | the generated `MessageEnvelope<T>` metadata and the hand-built polymorphic metadata both name `pri` (omitted when zero) | metadata that does not name the field drops it on every round trip |
| the storage conversion | `EnvelopeSerializer.SerializeEnvelope` copies the number into the `MessageEnvelope<JsonElement>` form | every store and ship path goes through this conversion |
| the typed receive | `ReconstructWithPayload` copies the number onto the typed envelope the handler sees | the inheritance rule reads the envelope in the handler's hand |
| the offload claim | `BodyOffloadPostSerializeHook` copies the number onto the claim envelope | the claim replaces the body, not the scheduling decision |
| the inbox drain | `InboxDrainWorker` stamps the row's number (the consumer's classification) on the envelope it hands to dispatch | the row wins over the producer's declaration, because the consumer already decided |
| a composite's fan-out | every child envelope and child row carries the composite's number | a fan-out never re-decides |

{verified: EnvelopeSerializerTests.SerializeEnvelope_CarriesThePriorityIntoTheStorageFormAsync, MessageEnvelopeExtensionsTests.ReconstructWithPayload_NonGeneric_KeepsThePriorityAsync, MessageEnvelopeExtensionsTests.ReconstructWithPayload_Generic_KeepsThePriorityAsync, BodyOffloadPostSerializeHookTests.RunAsync_AboveThreshold_TheClaimEnvelopeKeepsThePriorityAsync, JsonContextRegistryTests.PolymorphicEnvelope_RoundTripsThePriorityAsync, MessageJsonContextGeneratorTests.Generator_WithCompositeEvent_EnvelopeIsDispatchable_NotJustNameRegisteredAsync, CompositeInboxFanoutTests.TryExpand_ChildrenCarryTheCompositesPriorityAsync}

Why the drain seam mattered most: a bulk import stamped its fan-out background on its own rows, and
every other service received the same events at the standard number, because the drain rebuilt the
wire envelope field by field without the number and the fetch never returned it. The interactive
work still won at the consumer, but by one band instead of two, and the margin the design promises
was missing. The row-over-envelope rule at the inbox drain is the mirror image: the consumer's
classification is the number the handler's children inherit, so a consumer that pushes a message
down pushes everything the message causes down with it.

## The claim {#the-claim}

{verified: BucketAwareClaimSqlTests.ClaimOrphanedInbox_AnInteractiveStream_IsClaimedAheadOfOlderStandardStreamsAsync, BucketAwareClaimSqlTests.ClaimOrphanedInbox_AStreamWithAnInteractiveRowBehindStandardRows_IsPulledForward_InOrderAsync, BucketAwareClaimSqlTests.ClaimOrphanedInbox_BackgroundStreams_KeepAFloorOfTheBatchAsync, BucketAwareClaimSqlTests.ClaimOrphanedInbox_ABackgroundStreamPastItsWaitTarget_IsPromotedIntoTheStandardLaneAsync, BucketAwareClaimSqlTests.ClaimOrphanedInbox_CommandsStayAheadOfEvents_InsideABucketAsync, BucketAwareClaimSqlTests.ClaimWork_ReemitsHeldInboxStreams_MostUrgentBucketFirstAsync, BucketAwareClaimSqlTests.ClaimOrphanedPerspectiveEvents_TakesTheMostUrgentStreamsFirstAsync}

The claim is where contention latency is decided, and it happens in SQL, inside `claim_orphaned_inbox`,
`claim_work` and `claim_orphaned_perspective_events`, because a C# sort over rows the SQL already
chose cannot reach the flood. Migration `150_BucketAwareClaim.sql` schedules by bucket.

**The stream is the unit.** Per-stream FIFO means the scheduler never picks a row; it picks a stream
and takes that stream's rows in order. A stream is claimed by the bucket its most urgent pending row
falls in: an interactive row queued behind bulk rows on its own stream pulls the whole stream
forward, and the stream's head is what gets claimed first, since its predecessors are prerequisites.
Priority reorders streams, never rows within a stream.

**Three lanes, each bounded by the batch.**

- **Interactive** (lane 0): every stream with a pending interactive row anywhere in it. That set is
  small by nature and served by its own partial index, so the fold over all of a stream's pending
  rows costs the pending interactive rows, never the backlog.
- **Standard** (lane 1): standard rows, plus background rows whose stream has waited past the
  background wait target. Selected breadth-first with an early stop over the standard band's own
  arrival-order index, as the acquisition rewrite already does for events.
- **Background** (lane 2): background rows inside the wait target, selected the same way over the
  background band's index. The bucket always receives a floor of the batch (one tenth) while it has
  pending streams, so a steady standard flow can never starve it; whatever standard leaves unused
  goes to background as well.

Inside a lane a command keeps its place ahead of events (the command lane), then streams interleave
breadth-first as before. The streams an instance already holds are re-offered in the same order,
folded over the rows it holds, so the drain dispatches an interactive stream before the standard and
background ones it holds. The perspective claim selects the streams with the most urgent claimable
event first, oldest first within a priority, and re-offers held perspective streams bucket first.

**Aging.** Within a lane the oldest streams go first, which is aging inside a bucket. Across bands, a
background stream that has waited past the background wait target (five minutes in this release)
competes as standard. Interactive is never promoted into, so the urgent lane holds only declared
urgency; a host that wants a different rule sets a stream's number in the batch hook, where the
stream's oldest age is available.

**Why the fold is not a counter.** The design review settled on per-bucket pending counters on the
stream row. The release folds the interactive bucket with a partial-index probe instead, and folds
standard against background by the stream's head under load and by any pending row otherwise: a
counter has to be moved by every path that stores or removes a row (the store, completion, the
dead-letter move, purges, debug-mode stamping) and reconciled when one is missed, while the probe
costs the pending interactive rows, which the premise of the design keeps small. The counters remain
the answer if the interactive set ever grows large; nothing in the row shape precludes them.

## Composites {#composites}

{verified: CoalesceShipWorkerTests.RunOnce_DefaultFold_CompositeCarriesTheMostUrgentMemberAsync, CoalesceShipWorkerTests.RunOnce_LeastUrgentFold_CompositeCarriesTheLeastUrgentMemberAsync, CoalesceShipWorkerTests.RunOnce_ManualFold_CompositeCarriesTheBindingsNumberAsync, CoalesceShipWorkerTests.RunOnce_NoMemberDeclared_CompositeStaysUndeclaredAsync, PriorityOnTheWireSqlTests.FetchPendingCoalesce_ReturnsEachSinglesPriorityAsync, PriorityOnTheWireSqlTests.CompleteCoalesceFold_StoresTheCompositesPriorityAsync}

A composite minted by the coalesce ship worker bundles singles that were each declared when they
were produced, so the composite's number is a **fold over its members**, decided by the binding, and
the same fold the claim applies to a stream:

| `CoalescePolicyOptions.PriorityFold` | the composite carries | when |
|---|---|---|
| `MostUrgent` (the default) | the lowest declared number among the members | the bundle must never be scheduled behind the member somebody is waiting on |
| `LeastUrgent` | the highest declared number among the members | the bundle may wait with its slowest member: an audit digest, a metrics roll-up |
| `Manual` | whatever `PriorityFor(batch)` returns | the binding knows something the numbers do not |

Members that carry no number are left out of the fold; a composite whose members are all undeclared
stays undeclared and the consumer's rules classify it, because the worker never invents a band. A
`Manual` binding without a callback behaves the same way. The number lands on the composite's outbox
row and inside its envelope, crosses the wire like any other, and the consumer's fan-out gives every
child the composite's number, so an import's composite is background end to end and so is each
child it expands into.

```csharp{
title: "A digest that waits with its slowest member"
description: "Binds a coalesce group whose minted composite takes the least urgent member's number instead of the default most urgent fold."
framework: "NET10"
category: "Messaging"
difficulty: "INTERMEDIATE"
tags: ["priority", "coalesce", "composite", "background"]
tests: ["CoalesceShipWorkerTests.RunOnce_LeastUrgentFold_CompositeCarriesTheLeastUrgentMemberAsync", "CoalesceShipWorkerTests.RunOnce_ManualFold_CompositeCarriesTheBindingsNumberAsync"]
}
services.AddWhizbang(options => {
  options.Tags.Coalesce("record-digest", c => {
    c.SlideSeconds = 15;
    c.PriorityFold = CompositePriorityFold.LeastUrgent;   // the digest is never more urgent than its slowest record
  });
  options.Tags.Coalesce("ops-rollup", c => {
    c.PriorityFold = CompositePriorityFold.Manual;
    c.PriorityFor = batch => batch.Singles.Count > 100 ? WorkPriority.BACKGROUND : WorkPriority.STANDARD;
  });
});
```

The audit digest is background by construction: every `EventAudited` record is declared background
when it is built, so the fold over any batch of them is background whichever rule the binding uses.
{verified: AuditOutboxMessageBuilderCoverageTests.TryBuildAuditMessage_DeclaresTheAuditEventBackgroundAsync}

## Background work {#background-work}

{verified: AuditingEventStoreDecoratorPriorityTests.AppendAsync_WithEnvelope_QueuesTheAuditRecordAsBackground_OnTheRowAndTheEnvelopeAsync, AuditingEventStoreDecoratorPriorityTests.AppendAsync_TheAuditedEventsInteractiveNumber_DoesNotReachTheAuditRecordAsync, SystemEventEmitterPriorityTests.EmitEventAudited_TheAuditEnvelopeIsBackgroundAsync, SystemEventEmitterPriorityTests.EmitCommandAudited_TheAuditEnvelopeIsBackgroundAsync, IntegrityCheckpointWorkerPriorityTests.RunCheckpointOnce_WithTransport_EveryTopicCopyIsBackgroundAsync, IntegrityAuditWorkerPriorityTests.LocalGaps_TheReportAndTheRebuild_AreDispatchedInsideABackgroundHandlingAsync, IntegrityReceptorsPriorityTests.ManifestRequestReceptor_EveryManifestChunkIsBackgroundAsync, IntegrityManifestReceptorTests.ManifestReceptor_Divergence_TheRepairRequestIsBackgroundAsync, IntegrityManifestReceptorTests.ManifestReceptor_TypeLevelMismatch_TheDrillDownRequestIsBackgroundAsync, IntegrityManifestReceptorTests.ManifestReceptor_TypeLevelBulkDeficit_TheBackfillRequestIsBackgroundAsync, RepairDrainWorkerPriorityTests.DrainTick_EveryRepairRequestIsBackgroundAsync, SubscriptionExpansionWorkerPriorityTests.Expansion_TheBackfillRequestIsBackgroundAsync, RedeliveryPumpPriorityTests.Publish_EveryBundleOnTheWireIsBackgroundAsync, PriorityOnTheWireSqlTests.RecoverDeadLetter_OutboxRow_ReentersAsBackgroundAsync, PriorityOnTheWireSqlTests.RecoverDeadLetter_PerspectiveRow_ReentersAsBackgroundAsync}

Work the framework creates for itself is declared **background by construction**, on the envelope and on
the row, whatever the handling that caused it: nobody is waiting on it, and a flood of it at the standard
number sits ahead of live work in a FIFO outbox. The declaration is made where the message is built, not
by a rule a host has to remember:

| emitter | what it declares background |
|---|---|
| the audit decorator and the system event emitter | every `EventAudited` and `CommandAudited` record, and so the audit digest folded from them |
| the integrity checkpoint and audit workers | checkpoints, manifest requests, and the gap reports and rebuilds they dispatch (the worker enters a background handling, so the dispatcher's inheritance rule declares them) |
| the integrity receptors | manifest answers, drill-down and follow-up requests, repair and backfill requests |
| the repair drain and the subscription expansion worker | redelivery requests |
| the redelivery pump | every bundle it ships |
| `recover_dead_letter` (migration 151) | every row it re-creates: outbox, inbox, perspective, and a broker import re-entering through the inbox door |

The negative case is tested at each site as well: an audit record of an interactive event, or one built
while an interactive handling is in progress, does not inherit interactive. A worker's ambient background
handling ends with the cycle, so nothing that runs after it inherits background by accident.
{verified: AuditingEventStoreDecoratorPriorityTests.AppendAsync_InsideAnInteractiveHandling_TheAuditRecordStaysBackgroundAsync, IntegrityCheckpointWorkerPriorityTests.RunCheckpointOnce_DoesNotLeaveTheBackgroundHandlingBehindAsync, IntegrityAuditWorkerPriorityTests.RunAuditOnce_LeavesNoBackgroundHandlingBehindAsync, RedeliveryPumpPriorityTests.Publish_InsideAnInteractiveHandling_TheBundleStaysBackgroundAsync}

## Producer boundaries outside the dispatcher {#producer-boundaries}

{verified: DispatcherTransportBridgePriorityTests.PublishToTransportAsync_WhilePublishingBackgroundWork_TheEnvelopeCarriesTheAmbientParentAsync, DispatcherTransportBridgePriorityTests.PublishToTransportAsync_OutsideAnyHandling_TheEnvelopeStaysUndeclaredAsync, TransportManagerPriorityTests.PublishToTargetsAsync_WithTwoTargets_BothEnvelopesCarryTheSameNumberAsync, SecurityContextEventStoreDecoratorPriorityTests.AppendAsync_WithMessage_WhileHandlingBackgroundWork_TheEnvelopeCarriesTheAmbientParentAsync, InMemoryEventStorePriorityTests.AppendAsync_WithMessage_WhileHandlingBackgroundWork_TheStoredEnvelopeCarriesTheAmbientParentAsync, EventEnvelopeJsonbAdapterPriorityTests.RoundTrip_KeepsTheDeclaredNumberAsync, DapperPostgresEventStorePriorityTests.AppendAsync_WithMessage_WhileHandlingBackgroundWork_ReadsBackTheAmbientParentAsync, DapperSqliteEventStorePriorityTests.AppendAsync_WithMessage_WhileHandlingBackgroundWork_ReadsBackTheAmbientParentAsync}

A few places build an envelope without the dispatcher: the transport bridge and the transport manager
(direct publishes), and the event stores' raw `AppendAsync(streamId, message)` overloads that wrap a bare
message. They declare the **ambient parent** and nothing else: inside a handling the envelope carries the
handling's number, outside one it stays undeclared for the consumer's rules to classify. They consult no
hook and invent no band, the same rule the composite fold follows, because a boundary that cannot see the
dispatch context has nothing to derive a band from. The Dapper event stores persist the number with the
envelope (`pri` in the metadata column, omitted when undeclared) and restore it on read, so an event
appended while handling background work reads back as background. An envelope the caller built keeps its
own number at every one of these boundaries.
{verified: InMemoryEventStorePriorityTests.AppendAsync_WithEnvelope_KeepsTheEnvelopesOwnNumberAsync, EventEnvelopeJsonbAdapterPriorityTests.ToJsonb_WithAnUndeclaredNumber_OmitsPriAsync, EventEnvelopeJsonbAdapterPriorityTests.FromJsonb_WithoutPriInTheMetadata_StaysUndeclaredAsync}

## End to end {#end-to-end}

{verified: PriorityOnTheWireEndToEndTests.Interactive_ADispatchOutsideAnyHandling_CarriesInteractiveToEveryStoredPointAsync, PriorityOnTheWireEndToEndTests.Background_ADispatchWhileHandlingBackgroundWork_CarriesBackgroundToEveryStoredPointAsync, PriorityOnTheWireEndToEndTests.Explicit_ANumberOnTheDispatchOptions_CarriesThatNumberToEveryStoredPointAsync, PriorityOnTheWireEndToEndTests.TheStoredOutboxEnvelope_NamesTheNumberAsPriAsync}

One test composes the real dispatcher with the priority hooks, the real envelope serializer, the outbox
row in its stored JSON form, the outbox drain, the transport publish strategy over the in-process
transport, the consumer worker with the receive hooks, the inbox drain and the typed reconstruction, and
asserts the number at nine points: the outbox row, the stored outbox envelope, the stored JSON (which
names it `pri`), the wire envelope, the inbox row, the inbox row's envelope, the work item, the work item's
envelope, and the typed envelope the handler receives. It runs for an interactive dispatch, a dispatch
inside a background handling, and an explicit number on the dispatch options. Only the coordinator is an
in-memory row holder; everything the number crosses is the production code.

## Bulkheads {#bulkheads}

{verified: WorkCoordinatorGateInteractiveReserveTests.Acquire_NonInteractiveCallers_NeverTakeTheReservedSliceAsync, WorkCoordinatorGateInteractiveReserveTests.Acquire_AnInteractiveCaller_TakesTheReserveWhenTheSharedPermitsAreGoneAsync, WorkCoordinatorGateInteractiveReserveTests.Acquire_AnInteractiveCaller_UsesTheSharedPermitsFirstAsync, WorkCoordinatorGateInteractiveReserveTests.Reserve_DefaultsToOneTenthOfThePermits_AndNeverTheWholeGateAsync, WorkCoordinatorGateRegistrationTests.AddWhizbangWorkers_BindsTheInteractiveReserveFromConfigurationAsync, WorkCoordinatorGateRegistrationTests.AddWhizbangWorkers_WithoutAnInteractiveReserve_HoldsOneTenthBackAsync, WorkCoordinatorGateRegistrationTests.AddWhizbangWorkers_WithInteractiveReserveZero_DisablesTheReserveAsync}

Ordering alone does not protect latency when the shared resource is held by stalled bulk work. The
work coordinator gate, the process-wide cap on coordinator calls, reserves a slice of its permits
for interactive callers: a caller's bucket is the ambient parent of the handling it runs in, so a
coordinator call made while handling an interactive row may take a reserved permit when the shared
ones are gone, and a call made for anything else can never take the last reserved permits. Interactive
callers use the shared permits first, so the reserve is whole whenever it is needed. The reserve
defaults to one tenth of the permits, rounded down (a gate under ten permits reserves nothing unless
told to: a reserve that is half of a two-permit gate is a haircut, not a share), and is never the whole gate; `InteractiveReserve`
in the gate options sets it (bound from `Whizbang:WorkCoordinatorGate:InteractiveReserve`; 0 is the
operator's explicit word and disables the reserve).

The connection pool is not reserved by the framework. The pinned pool already gives the control
plane (claim, renewal, the completion flushers, the heartbeat) connections the drain bodies cannot
take, and the dispatch path's connections come from the host's Npgsql pool; the gate reserve bounds
what the framework's own callers can hold of that pool, which is the lever the framework has.

## Hooks {#hooks}

{verified: PriorityHooksTests.Chain_RunsProducerHooksInOrder_EachSeeingThePreviousAnswerAsync, PriorityHooksTests.Chain_RunsReceiveHooksInOrder_AndTheLastWordWinsAsync, PriorityHooksTests.Chain_WithNoHooks_ReturnsWhatItWasGivenAsync}

Every policy the framework ships is the default implementation of one of three hooks. A developer
whose case the provided options do not fit writes the policy; the framework keeps the invariants.

| hook | runs | sees | returns |
|---|---|---|---|
| `IPriorityProducerHook` | at dispatch | `PriorityDeclarationContext`: the envelope, the message type name, the dispatch context, whether it is scheduled, the parent's effective number, the number declared so far | the declared number |
| `IPriorityReceiveHook` | at the consumer's receive boundary, before the store | `PriorityReceiveContext`: the number declared so far, the envelope, the message type name | the effective number |
| `IPriorityBatchHook` | after each claim, before dispatch order is decided | `PriorityBatchEntry` for the stream (its folded number, oldest age, pending rows) and the batch around it | the stream's number for this batch |

The batch hook runs in the claim worker: after each claim the coordinator folds the inbox streams the claim
returned (the most urgent row, the oldest arrival and the rows in the batch, which `claim_work` returns with
each inbox row), the registered batch hooks adjust each stream's number, and the streams reach the drain in
the adjusted order, stable within equal numbers. With no batch hook registered the claim's own bucket order
stands. {verified: ClaimWorkerPriorityBatchHookTests.Distribute_RunsTheBatchHooks_AndHandsStreamsToTheDrainInTheAdjustedOrderAsync, ClaimWorkerPriorityBatchHookTests.Distribute_WithoutABatchHook_KeepsTheClaimsOrderAsync, BucketAwareClaimSqlTests.ClaimWork_ReturnsThePriorityAndArrivalOfHeldInboxRows_ForTheBatchHooksAsync}

Hooks run in `Order` (lower first; the framework defaults run at 1000), and each sees the previous
answer, so a host's hook composes with the defaults or replaces them by running later. Each hook is
a pure function over a context object, which makes a policy testable without a database. The batch
hook sets a stream's number, never a row's position, so per-stream order is an invariant no hook can
break.

```csharp{
title: "A producer hook that marks one namespace background"
description: "Runs before the framework default (Order 1000 runs last), so the default keeps the explicit declaration and the message is background whatever context it was dispatched from."
framework: "NET10"
category: "Messaging"
difficulty: "INTERMEDIATE"
tags: ["priority", "hooks", "producer", "background"]
tests: ["PriorityHooksTests.Chain_RunsProducerHooksInOrder_EachSeeingThePreviousAnswerAsync", "PriorityHooksTests.ProducerDefault_KeepsAnExplicitDeclarationAsync"]
}
public sealed class BulkNamespaceIsBackground : IPriorityProducerHook {
  public int Order => 100;

  public int DeclarePriority(PriorityDeclarationContext context) =>
    context.MessageTypeName.StartsWith("Contracts.Import.", StringComparison.Ordinal)
      ? WorkPriority.BACKGROUND
      : context.Declared;   // leave what an earlier hook decided; the default derives the rest
}

services.AddSingleton<IPriorityProducerHook, BulkNamespaceIsBackground>();
```

The defaults are registered by `AddWhizbang` through `AddWhizbangPriority`, with `TryAddEnumerable`,
so a host's own hook adds to the chain and a second registration of a default is a no-op:
{verified: PriorityHooksTests.Defaults_AreRegisteredByTheCoreRegistration_SoAHostGetsThemWithoutWiringAsync}

```csharp{
title: "The chain a host resolves"
description: "PriorityHookChain sorts the registered hooks of each kind once and threads each answer to the next; with nothing registered it returns its input."
framework: "NET10"
category: "Messaging"
difficulty: "ADVANCED"
tags: ["priority", "hooks", "chain", "dependency-injection"]
tests: ["PriorityHooksTests.Defaults_AreRegisteredByTheCoreRegistration_SoAHostGetsThemWithoutWiringAsync", "PriorityHooksTests.Chain_WithNoHooks_ReturnsWhatItWasGivenAsync"]
}
var chain = serviceProvider.GetRequiredService<PriorityHookChain>();
var declared = chain.DeclarePriority(new PriorityDeclarationContext(
  envelope, messageTypeName, envelope.DispatchContext,
  IsScheduled: false, ParentEffectivePriority: PriorityContext.CurrentParent, Declared: envelope.Priority));
```

### The ambient parent

The effective number of the message being handled is ambient while its handler runs, so anything
produced during that handling, including work the handler starts on another thread, can inherit it.
The dispatch workers enter it for the duration of a handler; leaving the handling clears it.
{verified: PriorityHooksTests.PriorityContext_FlowsTheParentsEffectiveNumberToWorkStartedWhileHandlingAsync}

```csharp{
title: "The ambient effective priority of the message being handled"
description: "PriorityContext.Enter sets the parent's number for the async flow of one handling; CurrentParent reads it, and Dispose restores what was there before."
framework: "NET10"
category: "Messaging"
difficulty: "ADVANCED"
tags: ["priority", "inheritance", "async-local", "handlers"]
tests: ["PriorityHooksTests.PriorityContext_FlowsTheParentsEffectiveNumberToWorkStartedWhileHandlingAsync"]
}
using (PriorityContext.Enter(effectivePriority)) {
  await handler.HandleAsync(message, ct);   // everything dispatched in here sees CurrentParent
}
```

## The C# API {#the-c-api}

{verified: WorkPriorityTests.Folds_IgnoreUndeclaredMembers_AndAgreeOnTheBandsAsync, WorkPriorityTests.Folds_OverNothingDeclared_StayUndeclaredAsync, WorkPriorityTests.Folds_AcceptAnythingPrioritized_NotOnlyNumbersAsync, WorkPriorityTests.FirstDeclared_PrefersTheFirstNumberSomebodySetAsync, DispatcherPriorityStampingTests.Send_WithAPriorityOnTheOptions_KeepsItOverTheContextRulesAsync, MessageEnvelopeExtensionsTests.WithPriority_SetsTheNumber_AndReturnsTheSameEnvelopeAsync}

The hooks are the policy surface; for the ordinary cases there is a small, plain API, and the
framework uses the same functions it offers, so a host's fold agrees with the claim's.

| member | what it does |
|---|---|
| `DispatchOptions.WithPriority(n)` | declares the number for one dispatch; the framework's default producer hook keeps an explicit declaration |
| `envelope.WithPriority(n)` | sets the number on a `MessageEnvelope<T>` and returns it, for a builder that declares and keeps constructing; `envelope.Priority` is the plain get and set |
| `IPrioritized` | the one interface every carrier exposes the number through: envelopes, outbox and inbox rows, batch rows, work items |
| `WorkPriority.MostUrgent(...)` | the lowest declared number in a collection of numbers or `IPrioritized` items; the stream fold and the composite default |
| `WorkPriority.LeastUrgent(...)` | the highest declared number |
| `WorkPriority.Average(...)` | the integer average of the declared numbers |
| `WorkPriority.FirstDeclared(a, b)` | `a` when it is declared, else `b`; the row-over-envelope rule the drains apply |

Every fold ignores undeclared members and returns `UNDECLARED` when nothing was declared, so a blank
never outvotes a declaration and a fold over nothing never lands in a band by accident.

```csharp{
title: "Declaring on one dispatch and folding a batch"
description: "Uses DispatchOptions.WithPriority for an explicit declaration and the shared fold helpers over a collection of rows."
framework: "NET10"
category: "Messaging"
difficulty: "BEGINNER"
tags: ["priority", "dispatch-options", "fold", "api"]
tests: ["DispatcherPriorityStampingTests.Send_WithAPriorityOnTheOptions_KeepsItOverTheContextRulesAsync", "WorkPriorityTests.Folds_AcceptAnythingPrioritized_NotOnlyNumbersAsync"]
}
// A re-index nobody is waiting on, started from an endpoint that would otherwise be interactive.
await dispatcher.SendAsync(new ReindexCatalog(tenantId), new DispatchOptions().WithPriority(WorkPriority.BACKGROUND));

// The band a batch of rows belongs to, by the same rule the claim uses for a stream.
IReadOnlyList<InboxMessage> batch = await FetchBatchAsync();
var mostUrgent = WorkPriority.MostUrgent(batch);          // rows are IPrioritized; no projection needed
var bucket = WorkPriority.Bucket(mostUrgent);
```

## What this release leaves for later {#later}

Three parts of the design were assessed for this release and deferred, each with its reason:

- **Lanes on the transport** (a bucket as a routing key to its own subscription). The transport
  traffic-classes routing this rides on is its own proposal and is not released; adding the bucket as
  a key before that routing exists would be a second design of the same mechanism. It follows the
  traffic-classes release.
- **Notification tags bound to coalescing by default.** The existing coalescing mechanism folds
  outbox-bound messages into composites, which the consumer expands back into the same children at
  dispatch, so binding notification tags to it would change the delivery shape without reducing the
  notifications the tag hooks push. The reduction the design wants belongs in the notification hook
  itself (one signal per tag per window), which is a new mechanism, not a policy binding over an
  existing one. It is filed as a follow-up.
- **Fairness across tenants** (a second round-robin key on the scope). The design records it as a
  second phase because it multiplies the scheduling budget's dimensions and needs its own
  measurements; nothing in this release precludes it.

## Decisions {#decisions}

Settled in review; the earlier open questions and their answers:

- **May a consumer raise a priority?** Yes. Lowering and raising are both allowed by a declared rule
  or the receive hook, never by inheritance, and both numbers are kept. Each consumer is in control
  of its own situation; a producer's number is advice with a good default, not a ceiling.
- **Does the producer declare explicitly, or does the framework derive only from context?** Both:
  the framework derives by default (the producer hook's default implementation), and a custom hook
  declares for the ambiguous cases.
- **How many classes?** A number with three buckets. The number gives fine ordering and arithmetic
  inside a bucket; the buckets give fair queuing its bounded set of queues. More buckets add
  round-robin queues, partial indexes and floors for little gain.
- **How is a stream's priority decided when its rows differ?** By a declared fold over all of its
  pending rows: most urgent by default, least urgent for bulk carriers, maintained as per-bucket
  counters so the claim never queries for it.
- **Where does the aging bound come from?** A wait target per bucket, defaulted by the framework from
  the measured drain, declarable by the producer, overridable by the consumer, applied inside a bucket
  and across bands.
- **What if the provided policies do not fit?** The producer, receive and batch hooks; the provided
  policies are their default implementations.
- **Which number does a minted composite carry?** A fold over its members, chosen by the binding:
  most urgent by default (the stream rule), least urgent, or the binding's own callback. The ship
  worker consults no producer hook of its own: the members were declared through the hooks when they
  were produced, and a fold of their numbers is not a new declaration.
- **Row or envelope, when the two disagree?** The row, once it exists. On the producer side the row
  and the stored envelope agree by construction; on the consumer side the row is the consumer's own
  classification, which is the number everything the handler causes should inherit.
- **What band does recovered and replayed work get?** Background, by construction, on every row
  recovery re-creates. Nobody is waiting on repair, and a recovered row that re-entered at the
  standard number sat ahead of live work.

## Related

- [Composite events](composite-events.md): a composite's children inherit the composite's effective
  number.
- [Claim backpressure](../../operations/workers/claim-backpressure.md): the outstanding budget the
  bucket shares divide.
- [Metrics](../../operations/observability/metrics.md): every decision the scheduler makes is
  counted by bucket.
