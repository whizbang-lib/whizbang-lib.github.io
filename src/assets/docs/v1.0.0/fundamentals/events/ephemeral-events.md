---
title: Ephemeral Events
pageType: concept
verifiedAgainstCommit: 03c5bb93
verifiedDate: 2026-10-20
version: 1.0.0
category: Core Concepts
order: 15
description: >-
  Declare an event ephemeral with [Ephemeral]: it is stored and routed like any event, but its body is
  deleted once every perspective has consumed it (or once its TTL passes), and the read model it feeds
  becomes the source of truth. Covers the attribute and its composition, what happens to the event and
  the read model, the WHIZ130, WHIZ131, WHIZ132, WHIZ134 and WHIZ139 build rules, the WHIZ133 mixed-stream refusal,
  the pairs a read model may allow to share a stream, the other runtime guards, compaction
  and scheduled stream closes.
tags: >-
  events, ephemeral, destruction, transient-storage, ttl, rewind-grace, reaper, snapshots, composition,
  profiles, WHIZ130, WHIZ131, WHIZ132, WHIZ133, WHIZ134, WHIZ139, mixed-streams, compaction, stream-close, full-history
codeReferences:
  - src/Whizbang.Data.Postgres/EphemeralHistoryReclassifyStep.cs
  - src/Whizbang.Data.Postgres/TypeHistoryWalker.cs
  - src/Whizbang.Core/TypeNameFormatter.cs
  - src/Whizbang.Core/Fingerprint/TypeDefinitionReconciler.cs
  - src/Whizbang.Data.Postgres/Migrations/381_EphemeralHistoryReclassifiesInBatches.sql
  - src/Whizbang.Data.Postgres/Migrations/392_WhatHoldsEphemeralHistoryBackIsNamed.sql
  - src/Whizbang.Data.Postgres/EphemeralBlockerReportText.cs
  - src/Whizbang.Data.Postgres/EphemeralReleaseList.cs
  - src/Whizbang.Core/Configuration/EphemeralBlockerReportOptions.cs
  - src/Whizbang.Core/Observability/EphemeralBlockerMetrics.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRunnerRegistry.cs
  - src/Whizbang.Generators/PerspectiveRunnerRegistryGenerator.cs
  - src/Whizbang.Core/SystemEvents/AuditEligibility.cs
  - src/Whizbang.Core/Attributes/EphemeralAttribute.cs
  - src/Whizbang.Core/Attributes/Destruction.cs
  - src/Whizbang.Core/Attributes/TransientStorage.cs
  - src/Whizbang.Core/Attributes/EphemeralInfo.cs
  - src/Whizbang.Core/Attributes/DangerouslyAllowMixedEphemeralAndSourcedEventsAttribute.cs
  - src/Whizbang.Core/Attributes/MixedStreams.cs
  - src/Whizbang.Core/Perspectives/MixedStreamAllowance.cs
  - src/Whizbang.Generators/Utilities/MixedStreamOptIn.cs
  - src/Whizbang.Data.Postgres/CoordinatorMixedStreamSql.cs
  - src/Whizbang.Data.Postgres/Migrations/393_AllowedPairsMayShareAStream.sql
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.RetentionSweeps.cs
  - src/Whizbang.Core/Attributes/DangerouslyAllowSourcedEventsFromEphemeralInputAttribute.cs
  - src/Whizbang.Core/Attributes/FullHistoryAttribute.cs
  - src/Whizbang.Core/IEphemeralEvent.cs
  - src/Whizbang.Core/ICompactedEvent.cs
  - src/Whizbang.Core/EphemeralModeResolver.cs
  - src/Whizbang.Core/Messaging/EphemeralFlagDeriver.cs
  - src/Whizbang.Core/Messaging/EphemeralTtlDeriver.cs
  - src/Whizbang.Core/Messaging/EventFlags.cs
  - src/Whizbang.Core/Messaging/MixedStreamEventException.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Observability/EnvelopeMetadata.cs
  - src/Whizbang.Core/Observability/PerspectiveMetrics.cs
  - src/Whizbang.Core/Lifecycle/Destruction.cs
  - src/Whizbang.Core/Lifecycle/OnDestroyFailure.cs
  - src/Whizbang.Core/Lifecycle/IDestructionHook.cs
  - src/Whizbang.Core/Lifecycle/StreamPrefixTruncator.cs
  - src/Whizbang.Core/Perspectives/Compacted.cs
  - src/Whizbang.Core/Perspectives/StreamCompactor.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRebuilder.cs
  - src/Whizbang.Core/Perspectives/PerspectiveSnapshotOptions.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTtlRegistry.cs
  - src/Whizbang.Core/Perspectives/FullHistoryPerspectiveRegistry.cs
  - src/Whizbang.Core/Archival/ScheduledPrefixTruncate.cs
  - src/Whizbang.Core/Archival/PrefixTruncateSchedule.cs
  - src/Whizbang.Core/Configuration/EphemeralOptions.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/EphemeralDestructionSql.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.EphemeralDestruction.cs
  - src/Whizbang.Data.Postgres/Migrations/310_EphemeralReapDeletesWhatTheHookSaw.sql
  - src/Whizbang.Data.EFCore.Postgres/ScheduledPrefixTruncateReceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/ScheduledPrefixTruncateReceptorRegistrar.cs
  - src/Whizbang.Generators/EphemeralAnalyzer.cs
  - src/Whizbang.Generators/Utilities/EphemeralResolver.cs
  - src/Whizbang.Generators/PerspectiveRunnerGenerator.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralHistoryReclassifySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/HistoryWalkTargetNamingTests.cs
  - tests/Whizbang.Core.Tests/TypeNameFormatterTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralBlockerReportSqlTests.cs
  - tests/Whizbang.Core.Tests/Configuration/EphemeralBlockerOptionsTests.cs
  - tests/Whizbang.Core.Tests/Observability/EphemeralBlockerMetricsTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRegistryMixedOptInTests.cs
  - tests/Whizbang.Generators.Tests/MixedStreamAllowanceGeneratorTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/MixedStreamAllowanceTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorDefaultsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MixedStreamAllowanceSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperMixedStreamAllowanceTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperEphemeralHistoryReclassifyTests.cs
  - tests/Whizbang.Core.Tests/SystemEvents/AuditEphemeralExclusionTests.cs
  - tests/Whizbang.Core.Tests/Attributes/EphemeralAttributeTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerDispositionTests.cs
  - tests/Whizbang.Generators.Tests/UnshippedDestructionAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/Ephemeral/EphemeralModeResolverTests.cs
  - tests/Whizbang.Core.Tests/Ephemeral/EphemeralFlagDeriverTests.cs
  - tests/Whizbang.Core.Tests/Ephemeral/EphemeralTtlDeriverTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/EvictedRowRebuildTests.cs
  - tests/Whizbang.Core.Tests/Observability/PerspectiveMetricsTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.StragglerDropped.cs
  - tests/Whizbang.Core.Tests/Perspectives/RewindDeletedArchiveTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/StreamCompactorTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/FullHistoryPerspectiveRegistryTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/StreamPrefixTruncatorTests.cs
  - tests/Whizbang.Core.Component.Tests/Lifecycle/StreamPrefixTruncatorDestructionStageComponentTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/DestructionContractTests.cs
  - tests/Whizbang.Core.Tests/Archival/PrefixTruncateScheduleTests.cs
  - tests/Whizbang.Core.Tests/Archival/ScheduledPrefixTruncateRenameTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerDestructionHookTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerReapDrivenSnapshotTests.cs
  - tests/Whizbang.Core.Tests/Fingerprint/TypeDefinitionReconcilerBranchCoverageTests.cs
  - tests/Whizbang.Core.Tests/Fingerprint/TypeDefinitionReconcilerCoverageTests.cs
  - tests/Whizbang.Generators.Tests/EphemeralAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/EphemeralAnalyzerOptInNameTests.cs
  - tests/Whizbang.Generators.Tests/EphemeralResolverCoverageTests.cs
  - tests/Whizbang.Generators.Tests/MessageTypeCatalogEphemeralTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerTemplateInvariantTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralBodyOffloadSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralBodyReaperSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralDestructionHoldSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralReapSeenSetTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralDestructionTargetSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/PerformMaintenanceDelegatesTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerReapScopeTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralEventStoreReadTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralSnapshotTargetSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralStreamGuardSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MixedStreamGuardSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ScheduledPrefixTruncateReceptorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TypeDefinitionReconcilerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Cursors/PerspectiveCursorAdvanceSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperWorkCoordinatorDeepPathTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperEphemeralDestructionHookTests.cs
lastMaintainedCommit: '62abd3a45'
---

# Ephemeral Events

Most events are **Sourced**: durable facts kept forever, so any read model can be rebuilt by
replaying them. Some events are not worth keeping. "User is typing", a cursor moved, a tab was
reordered: they matter for a moment, they arrive in volume, and nobody will replay them next year.
Marking such an event **ephemeral** tells Whizbang to delete it once it has done its job.

The trade is explicit. Once an ephemeral event's body is deleted it cannot be replayed, so the read
model it fed is no longer a cache that can be rebuilt from the log. **The read model becomes the
source of truth**, and Whizbang protects it as such: at build time, at rebuild and rewind, and in the
reaper itself.

## Which events should be ephemeral {#which-events}

Make an event ephemeral when its value is in the present, not in the history. An event is a good candidate when
all of these hold:

- **It is presence, progress, a heartbeat or a derived signal.** Examples: a user opened a tab, a job reached 40%,
  an instance is alive, a recommendation was recomputed.
- **It is superseded within minutes.** The next event of the same kind carries the current truth, so the older one
  tells no one anything.
- **No perspective rebuild needs it.** Replaying the stream from the start would not need this event to reach the
  right state, because the state it sets is overwritten or expires.
- **No one audits it.** Compliance and support questions are answered from durable events, not from this one.

Keep an event durable (Sourced) when it records a decision, a change of ownership, money, permissions, or anything a
rebuild or an audit has to replay. A stream holds either kind but not both: storing an event of the other kind on a
stream is refused at run time ([WHIZ133](../../operations/diagnostics/whiz133)), and a perspective that folds ephemeral and Sourced events
together is reported at build time ([WHIZ130](#whiz130)). Put ephemeral signals on a stream of their own.

## Declaring an ephemeral event

Put `[Ephemeral]` on the event, or implement `IEphemeralEvent`, the framework's ready-made profile
with the default settings.

```csharp{title="Ways to make an event ephemeral" description="A bare marker interface, a profile interface, a base record, and an event refining the profile it inherits." framework="NET10" category="Core Concepts" difficulty="BEGINNER" tags=["ephemeral", "events", "profiles", "composition"] tests=["MessageTypeCatalogEphemeralTests.ViaShippedMarker_ResolvesToDefaultsAsync", "MessageTypeCatalogEphemeralTests.ViaProfileInterface_ResolvesFromInterfaceAsync", "MessageTypeCatalogEphemeralTests.ViaBaseRecord_ResolvesFromBaseAsync", "MessageTypeCatalogEphemeralTests.MostSpecificWins_OwnAttributeOverridesInterfaceAsync"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;

// The shipped default profile: WhenConsumed, PersistedRow.
public record CursorMoved : IEphemeralEvent;

// A reusable profile on an interface.
[Ephemeral(Destruction = Destruction.WhenConsumed, Storage = TransientStorage.TtlRow)]
public interface IPresenceSignal : IEvent { }
public record UserWentIdle : IPresenceSignal;

// A profile on an abstract base record.
[Ephemeral(Destruction = Destruction.WhenConsumed, Storage = TransientStorage.TtlRow)]
public abstract record SessionState : IEvent;
public record TabsReordered : SessionState;

// The type's own attribute refines the profile it inherits.
[Ephemeral(Destruction = Destruction.AfterTtl, Storage = TransientStorage.TtlRow)]
public record PinnedPresence : IPresenceSignal;
```

### The settings

| Property | Default | Meaning |
|---|---|---|
| `Destruction` | `WhenConsumed` | When the event's body is deleted. See [Destruction modes](#destruction-modes). |
| `Storage` | `PersistedRow` | Where the read model built from the event lives. See [Read-model storage](#read-model-storage). |
| `RewindGraceSeconds` | `-1` | Per-type rewind grace window in seconds: how long a consumed body is kept so a late, out-of-order event can still rewind through it. `-1` uses the global setting. |
| `TtlSeconds` | `-1` | Age in seconds after which an `AfterTtl` event's body may be deleted. `-1` means no age limit. Meaningful only with `Destruction.AfterTtl`. |

{verified: EphemeralAttributeTests.Ephemeral_DefaultsToWhenConsumedPersistedRowAsync, EphemeralAttributeTests.Ephemeral_CarriesConfiguredValuesAsync, MessageTypeCatalogEphemeralTests.RewindGrace_Unset_DefaultsToMinusOneAsync, MessageTypeCatalogEphemeralTests.RewindGrace_Override_StampedOnEphemeralInfoAsync, MessageTypeCatalogEphemeralTests.Ttl_Override_StampedOnEphemeralInfoAsync, MessageTypeCatalogEphemeralTests.Ttl_Unset_DefaultsToMinusOneAsync}

### How the effective settings are resolved {#composition}

`[Ephemeral]` may sit on a class, a struct or an interface, at most once per type. Whizbang reads no
attributes at run time (and .NET reflection would not see one on an interface anyway). The source
generator resolves each type once, at build time, and walks:

1. the type's own `[Ephemeral]`,
2. then its base classes, nearest first,
3. then its interfaces.

The first attribute found wins, and **all four settings come from that one attribute**. A setting it
leaves out takes the attribute's default; it is not filled in from a less specific attribute further
down the walk. A type with no `[Ephemeral]` anywhere is Sourced.
{verified: EphemeralAttributeTests.Ephemeral_IsComposableOnTypeBaseAndInterfaceAsync, EphemeralAttributeTests.Ephemeral_IsInheritedAndSingleAsync, MessageTypeCatalogEphemeralTests.MostSpecificWins_OwnAttributeOverridesInterfaceAsync, MessageTypeCatalogEphemeralTests.SourcedEvent_HasNoEphemeralInfoAsync, EphemeralResolverCoverageTests.BaseTypeEphemeral_WithConflictingInterfaceProfiles_NoWHIZ134Async}

When the walk reaches the interfaces and finds two or more profiles that disagree on `Destruction` or
`Storage`, with neither extending the other, the type is ambiguous and the build fails with
[WHIZ134](#whiz134).

The result is stamped into the generated message-type catalog as an `EphemeralInfo` and looked up at
run time through `IEphemeralModeResolver`, which is registered by default. A type the catalog does not
know resolves as Sourced.
{verified: EphemeralModeResolverTests.Resolve_EphemeralEvent_ReturnsItsModeAsync, EphemeralModeResolverTests.Resolve_SourcedEvent_ReturnsNullAsync, EphemeralModeResolverTests.Resolve_UnknownType_ReturnsNullAsync, EphemeralModeResolverTests.Resolve_MultipleEphemeralTypes_KeepsEachDistinctModeAsync}

## What happens to the event

An ephemeral event is **stored and routed like any other event**. Delivery between instances goes
through the database, so an event that skipped the store could not reach the instance that owns its
stream. What differs is how long its body lives.

1. **Flagged at dispatch.** The dispatcher sets `EventFlags.Ephemeral` on the event, from the
   `IEphemeralEvent` marker or from the resolver. The flag is stored with the event.
   {verified: EphemeralFlagDeriverTests.Derive_MarkerEvent_NoResolver_IsEphemeralAsync, EphemeralFlagDeriverTests.Derive_ComposedEphemeral_ViaResolver_IsEphemeralAsync, EphemeralFlagDeriverTests.Derive_SourcedEvent_IsNoneAsync}
2. **Body stored separately.** The event's body lives in `wh_event_body`, apart from the slim
   `wh_event_store` pointer row. Reads join the two back together, whether the event arrived from this
   service's outbox or through the inbox.
   {verified: EphemeralBodyOffloadSqlTests.EmitChain_EphemeralEvent_OffloadsBodyToEventBody_NullInlineAsync, EphemeralBodyOffloadSqlTests.EmitChainInbox_EphemeralEvent_OffloadsBodyToEventBodyAsync, EphemeralBodyOffloadSqlTests.GetStreamEvents_EphemeralEvent_CoalescesOffloadedBodyBackAsync}
3. **Consumed.** Perspectives apply it like any event.
4. **Body deleted.** The maintenance worker deletes the body once every gate below is satisfied. The
   pointer row stays: a pointer without a body is how Whizbang knows the event existed and was reaped.
   Reading the stream afterwards skips the reaped event rather than failing.
   {verified: EphemeralBodyReaperSqlTests.Reap_EphemeralBody_GatedWhilePending_ReapedAfterConsumedAsync, EphemeralEventStoreReadTests.ReadPolymorphicAsync_ReapedEphemeralBody_IsSkippedNotThrownAsync}

### When the body is deleted {#reap-gates}

The delete runs in SQL, inside each maintenance cycle. A body is deleted only when **all** of these hold:

| Gate | Holds the body until | Verified |
|---|---|---|
| Consumption | No perspective work item for the event is still unprocessed. An event no perspective consumes passes at once. | {verified: EphemeralBodyReaperSqlTests.Reap_EphemeralBody_GatedWhilePending_ReapedAfterConsumedAsync, EphemeralBodyReaperSqlTests.Reap_NoConsumingPerspective_EphemeralBodyReapedAsync} |
| Rewind grace | The consumed body is older than the grace window: the type's `RewindGraceSeconds`, or the global `ephemeral_rewind_grace_seconds` (300 seconds unless configured). | {verified: EphemeralBodyReaperSqlTests.Reap_ConsumedEphemeralBody_HeldByGraceWindow_ReapedOnlyWhenAgedAsync, EphemeralBodyReaperSqlTests.Reap_PerTypeGraceOverride_ReapsAtItsOwnWindowAsync} |
| Snapshot coverage | Each consuming perspective has a snapshot at or past the event in its stream, so a rewind always has a floor to restore from. | {verified: EphemeralBodyReaperSqlTests.Reap_ConsumedBody_HeldUntilSnapshotCoversAsync, EphemeralBodyReaperSqlTests.Reap_SnapshotEarlierInTheStream_DoesNotCoverTheBodyAsync} |
| TTL (`AfterTtl` only) | The event's stamped expiry has passed. | {verified: EphemeralBodyReaperSqlTests.Reap_AfterTtl_StampedExpiry_HeldUntilPast_ThenReapedAsync, EphemeralBodyReaperSqlTests.Reap_AfterTtl_PastExpiry_StillHeldUntilSnapshotCoversAsync} |
| Holds | No destruction hold covers it (see [Destruction hooks](#destruction-hooks)). | {verified: EphemeralDestructionHoldSqlTests.Hold_KeepsBodyFromReap_ThenReapableWhenHoldLapses_AndHoldCleanedAsync} |
| Debug mode | `debug_mode` is off. Under debug mode nothing is reaped, so bodies stay for forensics. | {verified: EphemeralBodyReaperSqlTests.Reap_DebugMode_RetainsConsumedEphemeralBodyAsync} |

The reaper only ever deletes bodies of events flagged ephemeral. A Sourced event's body in the same
table is never touched, however old or consumed it is.
{verified: EphemeralBodyReaperSqlTests.Reap_SourcedBodyInBodyTable_IsNeverReapedAsync, EphemeralBodyReaperSqlTests.Reap_SourcedEvent_BodyRowUntouchedByMaintenanceAsync}

So that the coverage gate does not hold bodies indefinitely, each maintenance cycle first takes a
snapshot for every (stream, perspective) pair whose consumed, aged bodies are not yet covered, and
only then runs the delete.
{verified: MaintenanceWorkerReapDrivenSnapshotTests.RunMaintenanceOnce_ReapDrivenSnapshot_BootstrapsEachTargetPairAsync, EphemeralSnapshotTargetSqlTests.GetEphemeralPairsNeedingSnapshot_ReturnsConsumedAgedUncovered_ThenDropsAfterSnapshotAsync}

```mermaid{caption="An ephemeral event body is deleted only after it is consumed, older than the rewind grace window, covered by a snapshot, past its TTL when it has one, and not held; the pointer row remains." tests=["EphemeralBodyReaperSqlTests.Reap_EphemeralBody_GatedWhilePending_ReapedAfterConsumedAsync", "EphemeralBodyReaperSqlTests.Reap_ConsumedEphemeralBody_HeldByGraceWindow_ReapedOnlyWhenAgedAsync", "EphemeralBodyReaperSqlTests.Reap_ConsumedBody_HeldUntilSnapshotCoversAsync", "EphemeralBodyReaperSqlTests.Reap_AfterTtl_PastExpiry_StillHeldUntilSnapshotCoversAsync", "EphemeralDestructionHoldSqlTests.Hold_KeepsBodyFromReap_ThenReapableWhenHoldLapses_AndHoldCleanedAsync"]}
flowchart LR
  A["Ephemeral event stored<br/>(pointer + body)"] --> B{"Every consuming<br/>perspective done?"}
  B -- no --> B
  B -- yes --> C{"Older than<br/>rewind grace?"}
  C -- no --> C
  C -- yes --> D{"Covered by a<br/>snapshot?"}
  D -- no --> D
  D -- yes --> E{"AfterTtl: past<br/>its expiry?"}
  E -- no --> E
  E -- yes --> F{"Held by a<br/>destruction hook?"}
  F -- yes --> F
  F -- no --> G["Body deleted,<br/>pointer kept"]
```

Setting the per-type grace window:

```csharp{title="A per-type rewind grace window" description="Keep consumed bodies of a bursty event for 120 seconds instead of the global window." framework="NET10" category="Core Concepts" difficulty="INTERMEDIATE" tags=["ephemeral", "rewind-grace", "events"] tests=["MessageTypeCatalogEphemeralTests.RewindGrace_Override_StampedOnEphemeralInfoAsync"]}
[Ephemeral(Destruction = Destruction.WhenConsumed, RewindGraceSeconds = 120)]
public record BurstyPing : IEvent;
```

The global window is configured with `Whizbang:Ephemeral:RewindGraceSeconds` (see
[EphemeralOptions](../../operations/configuration/configuration-reference#ephemeraloptions)). The
per-type overrides are written to the database at startup.

### Destruction modes {#destruction-modes}

| Mode | What the framework does with it |
|---|---|
| `WhenConsumed` | The default. The body is deleted once consumed and past the gates above. There is no age limit. |
| `AfterTtl` | The type's `TtlSeconds` is stamped onto the event at dispatch and turned into an absolute expiry, `created_at + TtlSeconds`, using the database's clock and the event's stored creation time. The body is kept until that expiry has passed, **in addition to** the other gates: consumption does not release it early. |
| `OnCompaction` | **Not shipped: naming it fails the build ([WHIZ137](../../operations/diagnostics/whiz137)).** The framework has no compaction handler for event bodies; a PreDestruction hook can return `Disposition.Compact` with an `ICompactionHandler` registered instead ([dispositions](stream-end-of-life#dispositions)). Compaction of a stream is started explicitly; see [Compacting a stream](#compaction). |
| `Archived` | **Not shipped: naming it fails the build ([WHIZ137](../../operations/diagnostics/whiz137)).** The archive store moves a stream's prefix or whole stream, not event bodies; archive a stream through `IArchiveStore` or a prefix truncate with `Disposition.Archive`. An event-level archive is tracked in #1975. |

{verified: EphemeralAttributeTests.Destruction_HasTheFourStrategiesAsync, EphemeralTtlDeriverTests.Derive_AfterTtl_ReturnsTtlSecondsAsync, EphemeralTtlDeriverTests.Derive_WhenConsumed_NoTtl_IsNullAsync, EphemeralBodyReaperSqlTests.Reap_AfterTtl_StampedExpiry_HeldUntilPast_ThenReapedAsync, EphemeralBodyReaperSqlTests.Reap_ExpiryKeyIsTheDiscriminator_AfterTtlHeldWhileWhenConsumedReapsAsync}

The expiry is derived from `TtlSeconds`, so give `AfterTtl` events a `TtlSeconds`; without one they
reap like `WhenConsumed` events, as soon as they are consumed. That is deliberate, not a missing check. `OnCompaction`
and `Archived` cannot be declared at all (WHIZ137), so no event compiles into a delete it did not ask for. On the receive side the TTL is resolved from the message's wire type name, so an
`AfterTtl` event keeps its expiry when it crosses to another service.

## What happens to the read model {#read-model}

A perspective that applies **any** ephemeral event is an ephemeral perspective. Its read model is
authoritative state, and the generator configures its runner for that.

### Read-model storage {#read-model-storage}

`Storage` chooses where an ephemeral perspective's read model lives. It never changes how the event
itself is stored or delivered.

| Storage | Behavior at this version |
|---|---|
| `PersistedRow` | The default. A normal persisted perspective row with no expiry; it survives restarts and rebalancing and is queryable through lenses like any perspective. |
| `TtlRow` | A persisted row that expires. The generator registers a row TTL for every perspective that applies a `TtlRow` event: the longest `TtlSeconds` among those events (a `TtlRow` event with no `TtlSeconds` contributes none). Expiry and the maintenance sweep then work exactly as in [Perspective Row Retention](../perspectives/row-retention); an explicit `[RowTtl]` on the perspective outranks the derived TTL. |

An earlier `InMemory` option was removed: nothing acted on it, and a read model held in one instance's
memory would be lost whenever its stream moved to another instance. Whether an ephemeral event can stay
local and in memory, never persisted, is an open design question.

{verified: PerspectiveRunnerGeneratorTests.PerspectiveRunnerGenerator_TtlRowPerspective_RegistersRowTtlAsync, PerspectiveRunnerGeneratorTests.PerspectiveRunnerGenerator_NonTtlRowPerspective_DoesNotRegisterRowTtlAsync, MessageTypeCatalogEphemeralTests.ViaShippedMarker_ResolvesToDefaultsAsync}

```csharp{title="A read model that ages out with its events" description="An AfterTtl event with TtlRow storage gives the perspective that applies it a row TTL of the same length." framework="NET10" category="Core Concepts" difficulty="INTERMEDIATE" tags=["ephemeral", "ttl", "ttl-row", "perspectives"] tests=["PerspectiveRunnerGeneratorTests.PerspectiveRunnerGenerator_TtlRowPerspective_RegistersRowTtlAsync"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;
using Whizbang.Core.Perspectives;

[Ephemeral(Destruction = Destruction.AfterTtl, Storage = TransientStorage.TtlRow, TtlSeconds = 7776000)]
public record ChatMessage : IEvent {
  public string ThreadId { get; init; } = "";
}

public record ThreadModel {
  [StreamId]
  public string ThreadId { get; init; } = "";
}

public class ThreadPerspective : IPerspectiveFor<ThreadModel, ChatMessage> {
  public ThreadModel Apply(ThreadModel currentData, ChatMessage @event) => currentData;
}
```

### Snapshots

Because the reaper waits for a snapshot floor, ephemeral perspectives snapshot on their own, more
frequent cadence: every `EphemeralSnapshotEveryNEvents` events (default 10), keeping
`EphemeralMaxSnapshotsPerStream` snapshots per stream (default 1, since a rewind can never go below the
reaped history anyway). Sourced perspectives keep the standard cadence. See
[Perspective Snapshots](../perspectives/snapshots#perspectivesnapshotoptions).
{verified: PerspectiveRunnerGeneratorTests.PerspectiveRunnerGenerator_EphemeralPerspective_UsesAggressiveSnapshotSettingsAsync}

### Audit {#audit}

{verified: AuditEphemeralExclusionTests.AnEphemeralType_IsNotAuditedByDefaultAsync, AuditEphemeralExclusionTests.AnEphemeralTypeThatKeepsItsBody_IsAuditedAsync}

An ephemeral type is not audited unless it keeps its body with `[AuditEvent(IncludeBody = true)]`: an audit record points at its event by default, and the event is reaped. See [Audit logging](../security/audit-logging#ephemeral-events) for the rule and the reasons behind each part of it.

## Build-time rules

The `EphemeralAnalyzer` checks the rules that can be decided at build time: two from type symbols alone, one at
the call sites that name a perspective, and one on receptors.

### WHIZ130: a perspective mixing ephemeral and Sourced events {#whiz130}

A perspective that applies both an ephemeral event and a Sourced event gets a **warning**,
[WHIZ130](../../operations/diagnostics/whiz130). It cannot be both authoritative state and a cache
rebuilt from the log. The analyzer resolves each event's mode with the same walk the generator uses,
so an event made ephemeral through a profile interface counts.
{verified: EphemeralAnalyzerTests.PerspectiveMixesEphemeralAndSourcedApply_ReportsWHIZ130WarningAsync, EphemeralAnalyzerTests.MixViaComposedProfileInterface_StillReportsWHIZ130Async, EphemeralAnalyzerTests.PerspectiveAllEphemeralApply_NoWHIZ130Async, EphemeralAnalyzerTests.PerspectiveAllSourcedApply_NoWHIZ130Async}

Split the perspective in two, or make its events all one mode. When the mix is deliberate, mark the
perspective with `[DangerouslyAllowMixedEphemeralAndSourcedEvents]`. The long name is on purpose: it
is a visible, searchable decision in code review, and it works for teams that treat warnings as
errors and do not allow `#pragma` or `.editorconfig` suppressions. By applying it you accept that the
perspective cannot be safely rebuilt from the log.
{verified: EphemeralAnalyzerTests.MixedPerspectiveWithDangerousOptIn_NoWHIZ130Async, EphemeralAnalyzerOptInNameTests.UnboundOptIn_StillSuppressesWHIZ130Async, EphemeralAnalyzerOptInNameTests.UnrelatedAttribute_DoesNotSuppressWHIZ130Async}

```csharp{title="Opting in to a mixed perspective" description="The attribute silences WHIZ130 on a perspective that deliberately applies an ephemeral and a Sourced event." framework="NET10" category="Core Concepts" difficulty="ADVANCED" tags=["ephemeral", "WHIZ130", "perspectives", "opt-in"] testFile="EphemeralAnalyzerTests.cs" testMethod="MixedPerspectiveWithDangerousOptIn_NoWHIZ130Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralAnalyzerTests.cs" tests=["EphemeralAnalyzerTests.MixedPerspectiveWithDangerousOptIn_NoWHIZ130Async"]}
[DangerouslyAllowMixedEphemeralAndSourcedEvents]
public class DeliberatelyMixedProjection
  : IPerspectiveFor<Model, PresencePing>, IPerspectiveFor<Model, OrderPlaced> {
  public Model Apply(Model current, PresencePing e) => current;
  public Model Apply(Model current, OrderPlaced e) => current;
}
```

### Allowing mixed streams {#allowing-mixed-streams}

By itself the attribute changes nothing at run time: a stream still never holds both kinds
([WHIZ133](#runtime-guards)). Set its `Streams` property to `MixedStreams.Allow` to let the (ephemeral type, Sourced
type) pairs the read model applies share a stream. `MixedStreams.Refuse`, the default, is the attribute without the
property.

```csharp{title="Allowing a read model's pairs to share a stream" description="PresencePing and OrderPlaced may share a stream: either may be appended to a stream holding the other." framework="NET10" category="Core Concepts" difficulty="ADVANCED" tags=["ephemeral", "WHIZ130", "WHIZ139", "perspectives", "opt-in", "mixed-streams"] testFile="MixedStreamAllowanceGeneratorTests.cs" testMethod="Registry_AnAllowingReadModel_CarriesItsPairs_AndTheDefaultCarriesNoneAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/MixedStreamAllowanceGeneratorTests.cs" tests=["MixedStreamAllowanceGeneratorTests.Registry_AnAllowingReadModel_CarriesItsPairs_AndTheDefaultCarriesNoneAsync"]}
[DangerouslyAllowMixedEphemeralAndSourcedEvents(Streams = MixedStreams.Allow)]
public class PresenceBoard
  : IPerspectiveFor<Model, PresencePing>, IPerspectiveFor<Model, OrderPlaced> {
  public Model Apply(Model current, PresencePing e) => current;
  public Model Apply(Model current, OrderPlaced e) => current;
}
```

For an allowed pair:

- **Writes:** either kind may be appended to a stream holding the other. Any other type is still refused there, so a
  stream mixed under an allowance holds only the types of allowed pairs.
- **History:** the [history walk](#making-an-existing-type-ephemeral) no longer counts the pair as a blocker. It
  reclassifies the ephemeral events in such streams and leaves the Sourced ones Sourced.
- **Reaping:** the reaper reaps the ephemeral bodies in those streams on their normal rules, and keeps the Sourced ones.
- **Rebuild:** a read model that applies only the Sourced type rebuilds those streams as before. The opted-in read
  model applies the ephemeral type, so its full rebuild of them is refused, as for any ephemeral read model, and it
  restores from its snapshot floor.

**Safety.** A pair is allowed only when every read model that applies both of its types opts in with
`Streams = MixedStreams.Allow`. One that applies both without it keeps the pair refused: it would otherwise refuse to
rebuild the mixed streams and silently lose their Sourced events. The analyzer reports such a read model as a
**warning**, [WHIZ139](../../operations/diagnostics/whiz139), naming the pair and the read model that allows it. The
rule is applied again at run time over every registered read model, because read models in several assemblies
contribute to one registry.

The generator computes each read model's pairs, so the runtime needs no reflection. At startup the type-definition
reconciler writes the allowed pairs, under every name each type is stored by, to the store, which the mixed-stream
refusal reads; the history walk and the rebuild take them from the generated registry and pass them to the database as
bound parameters.

{verified: MixedStreamAllowanceTests.Allowed_TheDefaultRefuse_AllowsNothingAsync, MixedStreamAllowanceTests.Allowed_ASecondReadModelWithoutTheOptIn_KeepsThePairRefusedAsync, MixedStreamAllowanceGeneratorTests.SecondReadModelWithoutAllow_ReportsWHIZ139OnItAsync, MixedStreamAllowanceSqlTests.Append_AnAllowedPair_StoresEitherKindOnAStreamHoldingTheOtherAsync, MixedStreamAllowanceSqlTests.Reclassify_AnAllowedPair_ReclassifiesTheEphemeralEvents_KeepsTheDurable_AndTheDigestsEqualARecountAsync, MixedStreamAllowanceSqlTests.Reap_AnAllowedMixedStream_ReapsTheEphemeralBodies_AndKeepsTheDurableOnesAsync}

| Choice | Reason | Verified |
|---|---|---|
| `MixedStreams.Refuse` is the default, and the attribute without the property changes nothing at run time. | Silencing WHIZ130 and letting streams mix are separate decisions; an existing opt-in must not start mixing streams on upgrade. | {verified: MixedStreamAllowanceTests.Allowed_TheDefaultRefuse_AllowsNothingAsync, MixedStreamAllowanceGeneratorTests.Registry_AnAllowingReadModel_CarriesItsPairs_AndTheDefaultCarriesNoneAsync, MixedStreamAllowanceSqlTests.Append_WithNoAllowance_IsRefusedAsBeforeAsync, MixedStreamAllowanceSqlTests.Reclassify_WithNoAllowingReadModel_TheAllowedPairStillBlocksAsync} |
| `Allow` lets only the read model's own pairs mix; any other type is still refused on such a stream. | The allowance is for a pair, not for a stream: an unpaired type in a mixed stream would be skipped by its own read models' rebuilds. | {verified: MixedStreamAllowanceSqlTests.Append_AnAllowedPair_StoresEitherKindOnAStreamHoldingTheOtherAsync, MixedStreamAllowanceSqlTests.Append_AnUnpairedType_IsStillRefused_OnAStreamTheAllowanceMixedAsync, MixedStreamAllowanceSqlTests.Store_AnAllowedPairInOneOutboxWrite_StoresBothKindsAsync} |
| A pair is allowed only when every read model applying both types opts in, and WHIZ139 names one that does not. | One read model's opt-in must never break another's rebuild. | {verified: MixedStreamAllowanceTests.Allowed_ASecondReadModelWithoutTheOptIn_KeepsThePairRefusedAsync, MixedStreamAllowanceGeneratorTests.SecondReadModelWithoutAllow_ReportsWHIZ139OnItAsync, MixedStreamAllowanceGeneratorTests.EveryReadModelAllows_OrNoneDoes_NoWHIZ139Async} |
| The history walk reclassifies the ephemeral events of an allowed stream and keeps the Sourced ones, through the one digest fold. | Allowing mixing keeps the durable facts, unlike a release; the digests must still equal a recount. | {verified: MixedStreamAllowanceSqlTests.Reclassify_AnAllowedPair_ReclassifiesTheEphemeralEvents_KeepsTheDurable_AndTheDigestsEqualARecountAsync} |
| The reaper reaps the ephemeral bodies of an allowed stream and keeps the Sourced ones. | The point of declaring the type ephemeral is to reclaim it; the stream's durable events are not its to reap. | {verified: MixedStreamAllowanceSqlTests.Reap_AnAllowedMixedStream_ReapsTheEphemeralBodies_AndKeepsTheDurableOnesAsync} |
| A read model applying only the Sourced type rebuilds an allowed stream; the opted-in read model's full rebuild of it is refused. | The Sourced events are a complete log for a read model that never applies the ephemeral type; the opted-in read model is ephemeral state. | {verified: PerspectiveRebuilderTests.RebuildStreamsAsync_AnAllowedMixedStream_RebuildsForADurableOnlyReadModel_AndStaysRefusedForTheOptedInOneAsync, MixedStreamAllowanceSqlTests.StateBased_IgnoringTheAllowedEphemeralType_LeavesTheMixedStreamRebuildableAsync, DapperMixedStreamAllowanceTests.GetStateBasedStreamIdsAsync_PassingOverTheAllowedType_LeavesTheMixedStreamRebuildableAsync} |
| An engine that does not implement the allowance ignores no ephemeral type and syncs nothing. | The safe direction: every stream holding an ephemeral event stays refused, as before. | {verified: WorkCoordinatorDefaultsTests.MixedStreamDefaults_IgnoreNothing_AndSyncNothingAsync} |
| The allowed pairs are synced at startup as a full replace, under every stored name of each type. | A read model that drops the opt-in must refuse mixing again, and events stored under a former name hold a stream as the type does. | {verified: TypeDefinitionReconcilerCoverageTests.ReconcileAsync_SyncsTheAllowedMixedStreamPairs_UnderEveryStoredNameAsync, MixedStreamAllowanceSqlTests.Sync_ReplacesThePairs_AndAnEmptyListClearsThemAsync, MixedStreamAllowanceTests.Stored_AddsEachTypesFormerNames_FromTheCatalogAsync, DapperMixedStreamAllowanceTests.SyncMixedStreamAllowancesAsync_AllowsThePair_AndAnEmptyListAllowsNothingAsync} |

### WHIZ134: ambiguous composition {#whiz134}

A type that inherits `[Ephemeral]` from two or more sibling profile interfaces whose `Destruction` or
`Storage` differ, with no attribute on the type or a base class to settle it, is an **error**,
[WHIZ134](../../operations/diagnostics/whiz134). Profiles that agree, or a profile that extends the
other, are fine. Declaring `[Ephemeral(...)]` on the type resolves it.

{verified: EphemeralAnalyzerTests.TwoConflictingProfiles_ReportsWHIZ134ErrorAsync, EphemeralAnalyzerTests.TwoAgreeingProfiles_NoWHIZ134Async, EphemeralAnalyzerTests.RefinedProfileInheritance_NoWHIZ134Async, EphemeralAnalyzerTests.ConflictingProfilesWithOwnOverride_NoWHIZ134Async}

### WHIZ131: a rebuild or rewind of an ephemeral-only perspective {#whiz131}

Constructing a `RebuildPerspectiveCommand`, calling an `IPerspectiveRebuilder` rebuild, or calling
`IPerspectiveRunner.RewindAndRunAsync` for a perspective whose every event is ephemeral is an **error**,
[WHIZ131](../../operations/diagnostics/whiz131). There is nothing to replay, so the call can never do
anything. The analyzer resolves the perspective when it is named by a constant string (its CLR type name),
`typeof(T).FullName` or `TypeNameFormatter.FormatClrTypeName(typeof(T))`; a name known only at run time is
left to the runtime guard. A perspective that mixes modes is WHIZ130's to report.
{verified: EphemeralRebuildAnalyzerTests.RebuildCommand_NamingAnEphemeralOnlyPerspective_ReportsWHIZ131ErrorAsync, EphemeralRebuildAnalyzerTests.RebuilderCalls_NamingAnEphemeralOnlyPerspective_ReportWHIZ131Async, EphemeralRebuildAnalyzerTests.RewindRequest_AgainstAnEphemeralOnlyPerspective_ReportsWHIZ131Async, EphemeralRebuildAnalyzerTests.MixedAndSourcedPerspectives_NoWHIZ131Async}

### WHIZ132: a receptor turning an ephemeral message into a Sourced event {#whiz132}

A receptor whose input is ephemeral and whose response returns or cascades a Sourced event gets a
**warning**, [WHIZ132](../../operations/diagnostics/whiz132). The ephemeral message self-destructs, but what
it carried is now a durable fact in the event store. Any Sourced event in the response counts, whether or not
it copies the input. When it is deliberate, mark the receptor with
`[DangerouslyAllowSourcedEventsFromEphemeralInput]`, which works like the WHIZ130 opt-in.
{verified: EphemeralLaunderingAnalyzerTests.EphemeralInput_ReturningASourcedEvent_ReportsWHIZ132WarningAsync, EphemeralLaunderingAnalyzerTests.CascadedShapes_TupleArrayListAndRouted_ReportOnlyTheSourcedEventsAsync, EphemeralLaunderingAnalyzerTests.DeliberateReceptor_WithTheOptIn_NoWHIZ132Async}

```csharp{title="Opting in to a receptor that keeps a durable fact" description="The attribute silences WHIZ132 on a receptor that deliberately produces a Sourced event from an ephemeral message." framework="NET10" category="Core Concepts" difficulty="ADVANCED" tags=["ephemeral", "WHIZ132", "receptors", "opt-in"] testFile="EphemeralLaunderingAnalyzerTests.cs" testMethod="DeliberateReceptor_WithTheOptIn_NoWHIZ132Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralLaunderingAnalyzerTests.cs" tests=["EphemeralLaunderingAnalyzerTests.DeliberateReceptor_WithTheOptIn_NoWHIZ132Async"]}
[DangerouslyAllowSourcedEventsFromEphemeralInput]
public class PresenceToOrder : ISyncReceptor<PresencePing, OrderPlaced> {
  public OrderPlaced Handle(PresencePing message) => new();
}
```

## Runtime guards

Some misuses only show up at run time: a stream receiving both kinds of event, a rebuild that names a stream
by id, or an event that arrives after its predecessors' bodies are gone. These guards cover them.

**A stream never mixes ephemeral and Sourced events (WHIZ133).** Which events reach a stream is
only known when they are stored, so this is checked where outbox and inbox events are copied into the event
store and on every direct `IEventStore.AppendAsync`, not by the build. An event whose kind differs from the kind its stream already holds is refused, in
either order: one ephemeral event would mark the whole stream state-based and hide its
Sourced history from every rebuild and rewind. The one exception is a pair every read model applying both allows
(see [Allowing mixed streams](#allowing-mixed-streams)). A stream with nothing stored takes the kind of its first event.
A compaction origin is neither kind, so a compacted stream keeps receiving the kind it held. A write its caller
awaits (a direct append, and the immediate and scoped strategies' flush, which the dispatcher awaits when publishing) fails with `MixedStreamEventException`
and keeps nothing of the write; every other write (batch flushes, handler commits, the inbox) dead-letters
only the refused event, held for review, and stores the rest. Put ephemeral signals on a stream of their own.
See [WHIZ133](../../operations/diagnostics/whiz133).
{verified: MixedStreamGuardSqlTests.Store_SourcedEventOnAnEphemeralStream_DeadLettersTheSourcedEventAsync, MixedStreamGuardSqlTests.Store_EphemeralEventOnASourcedStream_DeadLettersTheEphemeralEventAsync, MixedStreamGuardSqlTests.Store_SourcedEventOnACompactedStream_IsStoredAsync, MixedStreamGuardSqlTests.Store_DirectCommitOfASourcedEventOnAnEphemeralStream_ThrowsMixedStreamEventExceptionAsync, MixedStreamGuardSqlTests.InboxChain_SourcedEventOnAnEphemeralStream_DeadLettersTheRowAndStoresTheRestAsync, DirectAppendMixedStreamGuardTests.DirectAppend_SourcedEventOnAnEphemeralStream_ThrowsAndStoresNothingAsync, DirectAppendMixedStreamGuardTests.DirectAppend_CompactionOriginOnAnEphemeralStream_IsStored_AndTheStreamStaysEphemeralAsync}

**Rebuilds refuse state-based streams.** A stream holding any ephemeral or compacted event is
*state-based*: its current state, not its log, is the truth. `RebuildStreamsAsync` filters such
streams out before replaying, logs each refusal, and counts them in the result's `StreamsRefused`. A
rebuild whose named streams were all refused is reported as a failure, not a success. The check asks
the work coordinator, which implements it on the EF Core Postgres driver; a coordinator without the
check refuses nothing.
{verified: PerspectiveRebuilderTests.RebuildStreamsAsync_SkipsEphemeralStreams_DoesNotReplayThemAsync, PerspectiveRebuilderTests.RebuildStreamsAsync_WhenEveryNamedStreamIsRefused_ReportsTheRefusalsAsAFailureAsync, EphemeralStreamGuardSqlTests.GetEphemeralStreamIds_ReturnsOnlyEphemeralStreamsAsync, EphemeralStreamGuardSqlTests.StateBased_IncludesCompacted_ButReaperDoesNotReapItAsync}

**Late events do not replay from zero.** When an out-of-order event forces a rewind, an ephemeral
perspective restores its latest snapshot and replays from there. If no snapshot exists before the late
event, a replay from the start would read reaped bodies and corrupt the model, so the runner skips the
rewind, logs a warning, keeps the current model and leaves the cursor where it was. The late event's
effect on earlier state is the accepted loss of arriving outside the grace window. A snapshot that cannot
be read (one written under an older serialization version) is no floor either, and the event is dropped the
same way.
{verified: PerspectiveRunnerGeneratorTests.PerspectiveRunnerGenerator_EphemeralPerspective_GuardsRewindFallbackAgainstReapedBodiesAsync, PerspectiveRunnerTemplateInvariantTests.EphemeralRewind_GuardsFullReplayFallbackAgainstReapedBodiesAsync, EvictedRowRebuildTests.EphemeralPerspective_RewindWithNoReadableFloor_NamesTheDroppedStragglerAndLeavesRowAndCursorAsync}

**A dropped straggler is dropped once.** The runner names the event it dropped, and the worker retires that
event's pending work in the same pass: the work rows are completed with nothing applied, the cursor is not
moved and nothing is replayed. The rest of the batch is still applied, and a second straggler in the same batch
is dropped the same way. The worker also remembers the dropped event, so a re-delivery of it under a new work row
is completed instead of dropped again. Each drop logs one Warning ("Straggler dropped: out-of-order rewind
window exceeded") and no "performing full replay" warning, because no replay runs. Earlier releases left the
dropped event's work pending, so every later claim found it again and logged the same drop without end; work
left looping that way is retired at the first claim after upgrading, and the cursor's rewind flag clears once
nothing is pending for it. The memory of dropped events lives in the process, so after a restart a straggler
that is delivered again may be dropped once more, once per process.
{verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_EphemeralStragglerWithNoSnapshotFloor_IsDroppedOnceAcrossLapsAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_StragglersLeftPendingByAnOlderBuild_StopAfterOneClaimAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_RunThatDropsAStragglerBelowTheRow_RetiresItAndAppliesTheRestAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_RunReportsADropOutsideItsBatch_RetiresNothingAndDoesNotRunAgainAsync, PerspectiveRunnerTemplateInvariantTests.EphemeralRewind_SkippedRewindNamesTheStragglerItDropsAsync, PerspectiveCursorAdvanceSqlTests.CompletePerspective_ADroppedStragglersWork_RetiresItClearsTheRewindFlagAndLeavesTheCursorAsync, DapperWorkCoordinatorDeepPathTests.CompletePerspectiveAsync_DroppedStragglersWork_RetiresItClearsTheRewindFlagAndLeavesTheCursorAsync}

**A second source.** Dropping a straggler is not only an ephemeral path: a rewind of any perspective whose replay needs a
[deleted archive](../perspectives/rewind#deleted-archive) also names its late event in `DroppedStragglers`, and the
worker retires and counts it the same way. That drop logs its own Warning ("Refusing rewind of ..."), not the
straggler line above.
{verified: RewindDeletedArchiveTests.ARewindFromTheStreamsStart_OfAStreamWhoseArchiveWasDeleted_IsRefused_AndNamesTheLateEventDroppedAsync, PerspectiveRunnerTemplateInvariantTests.EphemeralRewind_SkippedRewindNamesTheStragglerItDropsAsync}

**Watch `whizbang.perspective.stragglers_dropped`.** Every drop counts once on this counter, tagged with
`perspective_name`, whichever source dropped it (an ephemeral rewind with no floor, or a rewind refused for a
[deleted archive](../perspectives/rewind#deleted-archive)). The skipped rewind still counts in `whizbang.perspective.rewinds` (and
`whizbang.perspective.rewinds_triggered`), so a rewind count alone cannot tell a replay from a drop; this
counter does. A count that keeps rising means late events are arriving later than the perspective's reorder
window covers: snapshot more often (see [Snapshots](#snapshots)) or widen the rewind grace window (see
[When the body is deleted](#reap-gates)) so those events find a floor and rewind instead of being dropped. A
drop refused for a deleted archive is told apart by its warning; neither setting changes it. A rewind that
completes counts no drop.
{verified: PerspectiveMetricsTests.PerspectiveMetrics_StragglersDropped_CountsUnderItsNameWithThePerspectiveTagAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_RewindThatCompletes_CountsNoDroppedStragglerAsync}

**Evicted rows rebuild only from a snapshot.** When retention evicts an ephemeral perspective's row
and a later event arrives, the row is restored from its snapshot and the events after it. With no
snapshot to restore, the row starts fresh from the new event and a warning is logged, because the
earlier history is gone.
{verified: EvictedRowRebuildTests.EphemeralPerspective_EvictedRowWithSnapshot_RestoresTheSnapshotAndReplaysTheTailAsync, EvictedRowRebuildTests.EphemeralPerspective_EvictedRowWithoutSnapshot_StartsFreshAndWarnsAsync}

### Making an existing type ephemeral {#making-an-existing-type-ephemeral}

Events stored before a type gained `[Ephemeral]` are still Sourced. At startup the type-definition reconciler detects
the change, records it and logs it. To reclassify that history as ephemeral, which makes it reapable, set
`Whizbang:Ephemeral:ReconcileHistoricalOnStartup` to `true`. By default it only reports: rewriting stored history is a
deliberate step.

```json{
title: "Reclassifying the history of a type made ephemeral"
description: "Opts in to reclassifying the stored history of every ephemeral event type as ephemeral."
framework: "NET10"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["ephemeral", "configuration", "maintenance"]
}
{
  "Whizbang": {
    "Ephemeral": {
      "ReconcileHistoricalOnStartup": true
    }
  }
}
```

With the setting on, the `ephemeral-history-reclassify` maintenance step walks each ephemeral event type, under its
current name and every former name, and stamps its Sourced events ephemeral. Startup does not wait for it: the walk
starts in the first maintenance cycle after the service has settled, under the maintainer turn, like every other step
that rewrites stored rows. The setting can be turned on in any deploy and turned off once the walks are complete.

{verified: TypeDefinitionReconcilerTests.Reconcile_SettingsDriftToEphemeral_ActEnabled_RecordsLineage_AndTheMaintenanceStepReclassifiesAsync, TypeDefinitionReconcilerTests.Reconcile_SettingsDrift_DetectOnly_RecordsLineageButDoesNotReclassifyAsync, TypeDefinitionReconcilerCoverageTests.Reconcile_FlagOn_LeavesTheReclassifyToTheMaintenanceCycle_StartupDoesNotWaitOnItAsync, EphemeralHistoryReclassifySqlTests.ThePostgresDriver_RegistersTheStepAsync, DapperEphemeralHistoryReclassifyTests.HistoryStoredBeforeTheDeclaration_IsReclassifiedByTheRegisteredStepAsync}

**What it costs.** The step uses the same per-type history walker as the
[superseding reconcile](./superseding-events#history-reconcile-cost): the type's own stamped events in commit order,
read in the index on `(event_type, commit_sequence)`, 5,000 per batch, each batch its own short transaction, at most
20 batches a cycle across all types. A type with N stored events is reclassified in about N / 5,000 batches, whatever
the size of the store, and a crash resumes from the last committed batch.

{verified: EphemeralHistoryReclassifySqlTests.Reclassify_RunsInBoundedBatches_AndResumesFromItsCursor_AfterACrashAsync, EphemeralHistoryReclassifySqlTests.TheWalk_ReadsTheTypeThroughItsIndex_NeverTheStoreAsync}

| Choice | Reason | Verified |
|---|---|---|
| The reclassification runs in the maintenance cycle, in bounded batches, not as one statement at startup. | One statement over every stored event of a type held a lock on every touched row for its whole length, wrote one burst of WAL, made startup wait, and could run into the command timeout, after which nothing was reclassified and the next startup tried the same again. | {verified: TypeDefinitionReconcilerCoverageTests.Reconcile_FlagOn_LeavesTheReclassifyToTheMaintenanceCycle_StartupDoesNotWaitOnItAsync, EphemeralHistoryReclassifySqlTests.Reclassify_RunsInBoundedBatches_AndResumesFromItsCursor_AfterACrashAsync} |
| A stream that also holds a Sourced event of another type is left as it is, and its events are counted as blocked and logged. Each batch takes the per-stream locks the write paths take before judging a stream. | Reclassifying it would mix the stream (see WHIZ133 above). Under the locks, no event lands in the stream between the check and the stamp. | {verified: EphemeralHistoryReclassifySqlTests.Reclassify_AMixedStream_IsReportedAndLeftUntouched_AndTheDigestsEqualARecountAsync, EphemeralHistoryReclassifySqlTests.Reclassify_OnlyMixedStreams_ReportsThemBlocked_AndStillFinishesAsync} |
| The reclassified events leave the integrity digests through the one digest fold, batch by batch. | The stored digests then equal a recount of the Sourced events at every commit, so an audit running alongside the walk sees no false difference. | {verified: EphemeralHistoryReclassifySqlTests.Reclassify_AMixedStream_IsReportedAndLeftUntouched_AndTheDigestsEqualARecountAsync, StreamDigestWritersTests.ReclassifyEphemeral_SubtractsEveryLaneOfTheReclassifiedEventsAsync} |
| History stored under a former name is the same type: it is walked too, and a stream holding the type under two names is not mixed. | A rename does not change which events are the type's. | {verified: EphemeralHistoryReclassifySqlTests.Reclassify_FormerNames_AreWalked_AndAStreamHoldingBothIsNotMixedAsync} |
| Each walk names the type by its stored form, `Ns.Type, Assembly`, the form the append path writes to `event_type`; a former name from the pinned-type ledger, which records it bare, is read in the type's current assembly. The bare CLR name is used only to find the type's definition. | The walk reads the type's events through the index on `event_type`. Named by the bare CLR name, as it was until #2254, it matched no stored event and completed at once with every count at 0, so the setting reclassified nothing. A walk left complete under the bare name is a row of its own and does not stop the stored-name walk. | {verified: EphemeralHistoryReclassifySqlTests.TheWalk_NamesTheTypeAsTheAppendPathStoredIt_AndItsDefinitionByTheBareNameAsync, EphemeralHistoryReclassifySqlTests.AWalkCompletedUnderTheBareName_DoesNotStopTheStoredNameWalkAsync, HistoryWalkTargetNamingTests.EveryHistoryWalkStep_NamesItsTargetsAsTheAppendPathStoresThem_AndReadsThemAsync, TypeNameFormatterTests.FormatFormerName_ABareFormerName_TakesTheTypesAssemblyAsync} |
| A walk completes only once none of the type's events is still waiting for the commit-order stamper. | The walk reads in commit order, so an event not yet stamped is read once it is. | {verified: EphemeralHistoryReclassifySqlTests.Reclassify_EventsUnstampedAtTheStart_AreReclassifiedOnceStampedAsync} |
| A complete walk is not read again until the type-definition registry holds a newer definition of the type. | Events stored after the type became ephemeral are stored ephemeral; nothing new needs reclassifying. | {verified: EphemeralHistoryReclassifySqlTests.Reclassify_RunsInBoundedBatches_AndResumesFromItsCursor_AfterACrashAsync} |

**Which name the walk reads.** The event store keeps each event's type in its stored form, `Ns.Type, Assembly`. The
message-type catalog and the pinned-type ledger keep the bare CLR name, `Ns.Type`, so the step turns each into the stored
form before it walks. A guard runs every step that walks stored history against events written through the append path,
and fails if any walk is keyed by a name the store does not hold. The per-type rewind grace
(`[Ephemeral(RewindGraceSeconds = ...)]`) is keyed the same way, because the reaper matches it against `event_type`.

{verified: HistoryWalkTargetNamingTests.EveryHistoryWalkStep_NamesItsTargetsAsTheAppendPathStoresThem_AndReadsThemAsync, HistoryWalkTargetNamingTests.TheGuard_ReportsAWalkNamedOtherThanTheStoreDoesAsync, HistoryWalkTargetNamingTests.EveryHistoryWalkStep_IsCoveredByThisGuardAsync, TypeDefinitionReconcilerCoverageTests.ReconcileAsync_RewindGraceOverrides_AreKeyedByTheStoredName_TheEventStoreHoldsAsync}

The step logs, per type and cycle, the events it reclassified, the events it left Sourced in mixed streams and how many
of the type's events are left to read, and one line when a type's walk completes.

#### What holds ephemeral history back {#what-holds-ephemeral-history-back}

A large count of events left Sourced in mixed streams says how much history stays, not why. The blocker report says
why: for each ephemeral type, the durable (Sourced) event types that share its streams. It is on by default and is
recorded by the walk itself, from the streams each batch already locks, so it costs no extra pass over the store.

For each pair of ephemeral type and blocking type the report keeps:

- the events of the ephemeral type that stay Sourced, the streams they are in (each stream once per walk) and their
  approximate stored size;
- one sample stream id, to look at;
- the route of the blocking type: the service, topic, caller class and caller member of the hop that wrote it, from the
  newest [route](../../data/event-store#routes-and-traces) recorded for it (routes are recorded under the distilled
  metadata form; without one the report says so).

The report is logged once per ephemeral type when its walk finishes, and once at startup from the stored results. The
gauge `whizbang.ephemeral.blocked_events` (meter `Whizbang.Ephemeral`, see [metrics](../../operations/observability/metrics#ephemeral))
carries the same counts, tagged `ephemeral_type` and `blocking_type`.

```text{
title: "A blocker report entry"
description: "What the report logs for one durable type that keeps an ephemeral type's history Sourced."
framework: "NET10"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["ephemeral", "maintenance", "observability"]
}
Ephemeral history of Contracts.Sessions.SessionPinged, Contracts is held back by 1 durable event type(s):
  Contracts.Sessions.SessionOpened, Contracts: 3 event(s) in 2 stream(s), about 1,184 bytes; sample stream 0193...
    written by service sessions-service, topic sessions, SessionHandler.OpenAsync
    to clear it: (1) mark Contracts.Sessions.SessionOpened [Ephemeral] if it is transient everywhere; (2) release it in
    these streams only with the setting Whizbang:Ephemeral:ReleaseBlockers:Contracts.Sessions.SessionPinged:0 = Contracts.Sessions.SessionOpened, Contracts
    (no registered read model applies it); (3) keep it: these events and streams stay stored; (4) allow mixing, which
    keeps these durable events and lets the ephemeral ones go: put [DangerouslyAllowMixedEphemeralAndSourcedEvents(Streams = MixedStreams.Allow)]
    on every read model that applies both types: App.SessionBoard.
```

The report needs the walk, so it appears only with `ReconcileHistoricalOnStartup` on. Turn it off with
`Whizbang:Ephemeral:BlockerReport:Enabled` set to `false`; then nothing is recorded, logged or gauged, and the walk runs
exactly as it does without the report.

{verified: EphemeralBlockerReportSqlTests.Report_AMixedStream_NamesTheBlockingType_ItsCounts_ASampleStream_AndItsRouteAsync, EphemeralBlockerReportSqlTests.Report_ARouteWithOnlySomeParts_NamesWhatItHasAsync, EphemeralBlockerReportSqlTests.Report_WithoutARoute_OrAReadModel_SaysSoAsync, EphemeralBlockerReportSqlTests.StartupSummary_IsLoggedOnce_AndTheGaugeReadsTheStoredReportAsync, EphemeralBlockerReportSqlTests.Report_Off_RecordsNothing_LogsNothing_AndTheReclassifyIsUnchangedAsync}

Each entry ends in what to do. There are four choices:

1. **The blocking type is transient too:** mark it `[Ephemeral]` in code. The next walk clears both, and the route in
   the report points at the code that writes it.
2. **The blocking type is durable in general, but these streams are disposable:** release it for this ephemeral type
   only (below). The report prints the exact setting line to add.
3. **Keep it:** do nothing. The report shows what that costs: the events, the streams and their size.
4. **Allow mixing:** the durable events stay durable and the ephemeral ones go. Put
   `[DangerouslyAllowMixedEphemeralAndSourcedEvents(Streams = MixedStreams.Allow)]` on every read model that applies
   both types; the report prints the attribute line and names those read models (or says that none applies both, so
   there is none to opt in yet). Once allowed, the pair is no longer a blocker: see
   [Allowing mixed streams](#allowing-mixed-streams).

{verified: MixedStreamAllowanceSqlTests.Report_AnAllowedPair_IsNoBlocker_AndAnUnallowedOneOffersAllowMixingAsync, MixedStreamAllowanceSqlTests.Report_WhenNoReadModelAppliesBoth_SaysAllowMixingNeedsOneAsync}

#### Releasing a blocking type {#releasing-a-blocking-type}

`Whizbang:Ephemeral:ReleaseBlockers:<EphemeralType>` lists the durable types released for one ephemeral type. The key is
the ephemeral type's name, with or without its assembly; each value is a blocking type as the report prints it
(`Namespace.Type, Assembly`) or without its assembly.

```json{
title: "Releasing a blocking type for one ephemeral type"
description: "Reclassifies SessionOpened with SessionPinged in the streams that hold SessionPinged, and nowhere else."
framework: "NET10"
category: "Core Concepts"
difficulty: "ADVANCED"
tags: ["ephemeral", "configuration", "maintenance"]
}
{
  "Whizbang": {
    "Ephemeral": {
      "ReconcileHistoricalOnStartup": true,
      "ReleaseBlockers": {
        "Contracts.Sessions.SessionPinged": [ "Contracts.Sessions.SessionOpened, Contracts" ]
      }
    }
  }
}
```

A released type no longer keeps the ephemeral type's history Sourced. In each stream that holds the ephemeral type and
nothing else durable once the released types are set aside, the walk reclassifies the released type's Sourced events
along with the ephemeral type's, takes them out of the integrity digests the same way, and the ephemeral reaper then
reclaims them like any other consumed ephemeral event. Changing the list walks the type's history again, so a walk that
had already completed applies it.

**Safety.**

- Releasing is opt-in per pair. The default is empty: nothing durable changes without a setting.
- The report is the dry run: it shows, before anything is released, how many events and streams the setting would turn
  ephemeral.
- Only streams that hold the ephemeral type are touched. The released type's events in every other stream stay
  Sourced, and a stream that still holds another, unreleased durable type is left whole.
- A read model that applies the released type cannot be rebuilt from those events once they are reaped. The report
  names such read models next to the setting line.
- A released stream is ephemeral from then on, so a later Sourced append to it is refused like any mixed write (see
  WHIZ133 above). Release a type only when nothing writes it into those streams any more; the route in the report
  shows what does.

{verified: EphemeralBlockerReportSqlTests.Release_StampsTheBlockingEvents_OnlyInStreamsHoldingTheEphemeralType_AndTheDigestsEqualARecountAsync, EphemeralBlockerReportSqlTests.NoRelease_NoDurableEventChangesAsync, EphemeralBlockerReportSqlTests.Release_AStreamStillHeldByAnUnreleasedType_IsLeftWhole_AndReportedForThatTypeOnlyAsync, EphemeralBlockerReportSqlTests.Report_NamesTheReadModelsThatApplyTheBlockingType_NextToTheReleaseLineAsync, EphemeralBlockerReportSqlTests.Release_NamesWithOrWithoutTheAssembly_MatchTheConfiguredTypesAsync}

| Choice | Reason | Verified |
|---|---|---|
| The report is on by default. | It only counts what the walk already reads and changes no event; an operator who expected a reclaim needs it without first knowing to ask. | {verified: EphemeralBlockerOptionsTests.Defaults_TheReportIsOn_AndNothingIsReleasedAsync} |
| With the report off, nothing is recorded, logged or gauged, and the walk keeps its earlier variant. | Off must mean off: no rows to clean up, no log noise, and no restarted walk. | {verified: EphemeralBlockerReportSqlTests.Report_Off_RecordsNothing_LogsNothing_AndTheReclassifyIsUnchangedAsync} |
| The report is recorded inside the walk's batches, under the locks they already hold. | A separate pass over the store would cost the store's size; this costs only the blocked streams of each batch. | {verified: EphemeralBlockerReportSqlTests.Report_AMixedStream_NamesTheBlockingType_ItsCounts_ASampleStream_AndItsRouteAsync} |
| The counts describe the type's current walk: a restarted walk (a newer definition, a changed release list or report setting) starts them again. | Counts summed across walks would grow on every restart and describe nothing. | {verified: EphemeralBlockerReportSqlTests.Counts_DescribeTheCurrentWalk_AndResetWhenItRestartsAsync, EphemeralBlockerReportSqlTests.Counts_OfAnEarlierWalk_AreNotReported_EvenBeforeTheRestartedWalkReadsABatchAsync} |
| A stream is counted once per walk, however many batches read its events. | The streams figure is what a release would turn ephemeral; counting a stream per batch would overstate it. | {verified: EphemeralBlockerReportSqlTests.Streams_AreCountedOnce_WhenTheirEventsSpanSeveralBatchesAsync} |
| Nothing durable changes without a release setting. | Turning durable events ephemeral is a deliberate, potentially lossy step; the report is the dry run. | {verified: EphemeralBlockerReportSqlTests.NoRelease_NoDurableEventChangesAsync} |
| A release reclassifies the blocking type only in streams that hold the ephemeral type, and only once the stream is wholly ephemeral. | The blocking type is durable everywhere else; a partly released stream would be mixed. | {verified: EphemeralBlockerReportSqlTests.Release_StampsTheBlockingEvents_OnlyInStreamsHoldingTheEphemeralType_AndTheDigestsEqualARecountAsync, EphemeralBlockerReportSqlTests.Release_AStreamStillHeldByAnUnreleasedType_IsLeftWhole_AndReportedForThatTypeOnlyAsync} |
| A changed release list walks the type again. | A completed walk reads nothing more, so a release added after it would otherwise never apply. | {verified: EphemeralBlockerReportSqlTests.ChangingTheReleaseList_WalksTheTypeAgain_AndReleasesWhatTheCompletedWalkLeftAsync} |
| The release list reaches the database as a bound parameter. | A type name is data; it is compared, never executed. | {verified: EphemeralBlockerReportSqlTests.Release_ANameIsBoundAsData_NeverSqlTextAsync} |
| A pair that leaves the report reads zero on the gauge. | A stale count would say the pair still holds history back. | {verified: EphemeralBlockerMetricsTests.BlockedEvents_APairThatLeftTheReport_ReadsZero_NotItsLastCountAsync} |
| Each entry offers a fourth action, allow mixing, with the exact attribute line and the read models that must carry it; an allowed pair is no blocker. | Mark-ephemeral and release both give up the durable events; allowing mixing is the one choice that keeps them and still reclaims the ephemeral ones. | {verified: MixedStreamAllowanceSqlTests.Report_AnAllowedPair_IsNoBlocker_AndAnUnallowedOneOffersAllowMixingAsync, MixedStreamAllowanceSqlTests.Report_WhenNoReadModelAppliesBoth_SaysAllowMixingNeedsOneAsync} |

#### Read models opted into mixing {#read-models-opted-into-mixing}

A read model that carries `[DangerouslyAllowMixedEphemeralAndSourcedEvents]` applies both kinds on purpose. The
attribute only silences [WHIZ130](#whiz130) at build time; without `Streams = MixedStreams.Allow` it changes nothing at
runtime (see [Allowing mixed streams](#allowing-mixed-streams)). The blocker report covers
each such read model too, once per process with the startup summary: for each of its durable inputs, how many of its
events are still stored, in how many streams, and how many of those streams also hold one of its ephemeral inputs
(history only: the store refuses new mixing).

- **No durable events left:** the report says the read model is ready to drop the attribute. Remove it and the
  durable `Apply` methods, and the read model becomes purely ephemeral (its rebuild is then refused, as for any
  ephemeral read model).
- **Durable events remain:** the report names each durable input with its counts. When an input shares streams with
  an ephemeral type, it is also a blocker above, and the entry says so and points at
  [releasing it](#releasing-a-blocking-type) if those streams are disposable.

The generated perspective registry carries the opt-in (`PerspectiveRegistrationInfo.AllowsMixedEphemeralAndSourced`),
so the report needs no reflection.

{verified: EphemeralBlockerReportSqlTests.MixedReadModel_WithNoDurableInputLeft_IsReportedReadyToDropTheAttributeAsync, EphemeralBlockerReportSqlTests.MixedReadModel_WithDurableInputsLeft_ReportsTheirCounts_InTheirOwnStreamsAsync, EphemeralBlockerReportSqlTests.MixedReadModel_ADurableInputSharingStreams_IsLinkedToItsBlockerEntryAsync, PerspectiveRegistryMixedOptInTests.Registry_MarksAPerspectiveThatAllowsMixing_AndOnlyThatOneAsync}

| Choice | Reason | Verified |
|---|---|---|
| The generated registry records which read models carry the opt-in. | The attribute is compile-time only; without the registry the runtime could not know which read models to report, and reading it by reflection would break AOT. | {verified: PerspectiveRegistryMixedOptInTests.Registry_MarksAPerspectiveThatAllowsMixing_AndOnlyThatOneAsync} |
| A read model whose durable inputs have no stored event left is reported ready to drop the attribute. | That is the moment the opt-in stops buying anything, and nothing else tells the operator. | {verified: EphemeralBlockerReportSqlTests.MixedReadModel_WithNoDurableInputLeft_IsReportedReadyToDropTheAttributeAsync} |
| Remaining durable inputs are counted, and linked to their blocker entry when they share streams. | The counts say how far the read model is from purely ephemeral; the link shows which release would close the gap. | {verified: EphemeralBlockerReportSqlTests.MixedReadModel_WithDurableInputsLeft_ReportsTheirCounts_InTheirOwnStreamsAsync, EphemeralBlockerReportSqlTests.MixedReadModel_ADurableInputSharingStreams_IsLinkedToItsBlockerEntryAsync} |
| It is counted once per process, not per cycle. | It reads each durable input's stored events; once at startup keeps that cost out of every maintenance cycle. | {verified: EphemeralBlockerReportSqlTests.MixedReadModel_WithNoDurableInputLeft_IsReportedReadyToDropTheAttributeAsync} |

## Destruction hooks {#destruction-hooks}

Register an `IDestructionHook` to act on bodies before they are deleted: write a summary, archive
them, or decide to keep them. The maintenance worker calls `OnBeforeDestructionAsync` **once per
cycle** with every event it is about to reap in `DestructionContext.Targets`, before the delete, and
`OnAfterDestructionAsync` after the delete has committed.
{verified: MaintenanceWorkerDestructionHookTests.RunMaintenanceOnce_HookRegistered_FiresOnceForTheBatchBeforeReapThenAfterAsync}

The hook returns a `DestructionResult`:

| Result | Effect |
|---|---|
| `DestructionResult.Proceed()` | The batch runs its declared disposition, which for an ephemeral batch is a delete. |
| `DestructionResult.Proceed(Disposition.Compact)` | The registered `ICompactionHandler` runs over the batch, then the batch is deleted; with no handler registered the batch is held for the retry backoff and logged ([dispositions](stream-end-of-life#dispositions)). |
| `DestructionResult.Proceed(Disposition.Archive)` or `(Disposition.CryptoShred)` | The reaper cannot carry either out for event bodies: the batch is held for the retry backoff and logged, never deleted. |
| `DestructionResult.Canceled` | The whole batch is held indefinitely. Nothing is deleted and the after-hook does not run. |
| `DestructionResult.Defer(until)` | The batch is held until `until`, then offered again. |

{verified: MaintenanceWorkerDestructionHookTests.RunMaintenanceOnce_HookCancels_HoldsBatchFarFuture_NoPostDestructionAsync, MaintenanceWorkerDestructionHookTests.RunMaintenanceOnce_HookDefers_HoldsBatchUntilInstant_NoPostDestructionAsync, DestructionContractTests.DestructionResult_Proceed_WithoutADisposition_NamesNone_SoTheDeclaredOneRunsAsync, MaintenanceWorkerDispositionTests.Compact_RunsTheHandlerOverTheBatch_ThenReapsAsync, MaintenanceWorkerDispositionTests.Compact_WithNoHandler_HoldsTheBatchForTheBackoff_AndLogsWhyAsync, MaintenanceWorkerDispositionTests.CryptoShred_HoldsTheBatchForTheBackoff_AndLogsWhyAsync}

If the hook throws, the batch is held for a backoff (`DestructionRetryBackoffSeconds`) and offered
again, up to `MaxDestructionRetries` times. What happens after that is the `OnDestroyFailure` policy on the
maintenance worker options: `RetryThenForcedDelete` (the default) deletes anyway, so a broken hook
cannot leak storage; `RetryThenKeep` keeps the data; `ForceDeleteImmediately` deletes on the first
failure. See [MaintenanceWorkerOptions](../../operations/configuration/configuration-reference#maintenanceworkeroptions)
and the [destruction lifecycle stages](../lifecycle/lifecycle-stages#destruction).
{verified: MaintenanceWorkerDestructionHookTests.RunMaintenanceOnce_HookThrows_RecordsFailureForRetry_NoPostDestructionAsync, EphemeralDestructionHoldSqlTests.RecordDestructionFailure_HoldsForRetry_ThenForcedDeletePastCapAsync, EphemeralDestructionHoldSqlTests.RecordDestructionFailure_RetryThenKeep_KeepsPastCapAsync, EphemeralDestructionHoldSqlTests.RecordDestructionFailure_ForceDeleteImmediately_ReapsOnFirstFailureAsync}

A hook can preserve data or emit ephemeral events, but it cannot turn an ephemeral event back into a
durable Sourced one; there is no "promote" result.

### The reap deletes only what the hook saw {#reap-deletes-what-the-hook-saw}

{verified: EphemeralReapSeenSetTests.Delete_ABodyThatBecomesEligibleWhileTheHookRuns_IsNotReapedUnseen_AndIsOfferedNextCycleAsync, EphemeralReapSeenSetTests.Compact_ABodyThatBecomesEligibleWhileTheHandlerRuns_IsNotReapedUncompacted_AndIsCompactedNextCycleAsync}

The worker reads the batch, runs the hook (and a compaction handler) over it, and then the reap runs as a separate
statement. A body can become eligible in between: its grace window or TTL passes, its perspective work finishes, or a
snapshot comes to cover it. Such a body is not reaped in that cycle; the next cycle offers it to the hook like any other
(#1999).

The other direction holds too: the hook is offered only bodies the reap would delete. The batch is read with the reap's
own gates, its TTL floor included, so an `AfterTtl` body is offered to the hook only once its expiry has passed, which
is exactly when the reap deletes it. Offered, deleted and reported destroyed agree (#2018).
{verified: EphemeralDestructionTargetSqlTests.GetEphemeralBodiesAboutToReap_AnAfterTtlBodyNotYetExpired_IsNotOffered_AndOfferedMatchesDeletedAsync}

| Choice | Reason | Verified |
|---|---|---|
| The worker passes the batch it read to the reap, which deletes only those bodies; every other gate still applies to them. | A hook's `Canceled`, `Defer` and holds, and a compaction, can only apply to bodies the hook was given. Reaping a body the hook never saw bypasses all of them, and for `Compact` discards detail no summary holds. | {verified: EphemeralReapSeenSetTests.Delete_ABodyThatBecomesEligibleWhileTheHookRuns_IsNotReapedUnseen_AndIsOfferedNextCycleAsync, EphemeralReapSeenSetTests.Compact_ABodyThatBecomesEligibleWhileTheHandlerRuns_IsNotReapedUncompacted_AndIsCompactedNextCycleAsync, EphemeralReapSeenSetTests.Reap_GivenIds_DeletesOnlyThose_AnEmptyListNothing_AndNullEveryEligibleBodyAsync} |
| The batch the hook is offered is read with every gate the reap applies, including the `AfterTtl` expiry: a body whose TTL has not passed is not offered. | A body offered and then kept by the reap was run through the hook and reported destroyed by the after-destruction notification while it survived. Reading with the reap's own gates makes "offered", "deleted" and "reported destroyed" the same set. Locked by [`EphemeralDestructionTargetSqlTests`](https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralDestructionTargetSqlTests.cs). | {verified: EphemeralDestructionTargetSqlTests.GetEphemeralBodiesAboutToReap_AnAfterTtlBodyNotYetExpired_IsNotOffered_AndOfferedMatchesDeletedAsync} |
| The batch is passed by event id, not as a cut-off instant. | An instant covers only the gates that depend on time. A body whose perspective work finished, or that a snapshot came to cover, after the read would still go unseen. | {verified: EphemeralReapSeenSetTests.Reap_GivenIds_DeletesOnlyThose_AnEmptyListNothing_AndNullEveryEligibleBodyAsync} |
| The restriction holds whatever the hook decided: proceeded, canceled, deferred, refused or threw. An empty batch reaps nothing. | Held bodies are kept by their hold. When a hook keeps failing, the failure policy lifts the hold on the batch so the reap force-deletes it, and that deletion must reach only bodies the hook was offered. | {verified: MaintenanceWorkerReapScopeTests.AHeldBatch_CanceledDeferredOrUnavailable_StillRestrictsTheReapToItAsync, MaintenanceWorkerReapScopeTests.AHookThatThrows_RestrictsTheReapToTheBatch_SoAForcedDeleteReachesOnlyItAsync, MaintenanceWorkerReapScopeTests.AnEmptyBatch_RestrictsTheReapToNothingAsync} |
| With no hook and no destruction-stage receptor registered, no batch is read and the reap is unrestricted. | Nothing is registered to see a body, so there is nothing to bypass. | {verified: MaintenanceWorkerReapScopeTests.WithNoHook_NoBatchIsRead_AndTheReapIsUnrestrictedAsync} |
| The ids travel in the maintenance call itself, `wh_perform_maintenance(p_ephemeral_reap_event_ids)` (migration 310), so the cycle runs no extra statement. `perform_maintenance()` keeps its name and arity and calls it with no restriction. | `perform_maintenance` is a contract function that every engine and test calls; a second arity would add an overload beside every earlier definition. A whole redefinition of `perform_maintenance()` from an older migration fails a test, because the worker would no longer run it. | {verified: PerformMaintenanceDelegatesTests.PerformMaintenance_ItsNewestDefinition_OnlyCallsWhPerformMaintenanceAsync, PerformMaintenanceDelegatesTests.WhPerformMaintenance_ItsNewestDefinition_RestrictsTheEphemeralReapToTheGivenIdsAsync} |
| An engine that implements only the unrestricted maintenance call runs it for the restricted one. | Such an engine has no ephemeral body offload, so its batch is always empty and it has nothing to restrict. Both Postgres drivers implement the restricted call; see [destruction hooks on every data layer](#destruction-hooks-on-every-data-layer). | {verified: MaintenanceWorkerReapScopeTests.TheRestrictedCall_OnAnEngineThatImplementsOnlyTheUnrestrictedOne_RunsItAsync} |

### Destruction hooks on every data layer {#destruction-hooks-on-every-data-layer}

{verified: DapperEphemeralDestructionHookTests.AConsumedAgedBody_IsOfferedToTheHook_ThenReaped_AndAnnouncedAsync, DapperEphemeralDestructionHookTests.AHookThatCancels_KeepsTheBody_AndIsNotOfferedItAgainWhileTheHoldStandsAsync, DapperEphemeralDestructionHookTests.ABodyThatBecomesEligibleWhileTheHookRuns_SurvivesTheCycle_AndIsOfferedOnTheNextAsync, DapperEphemeralDestructionHookTests.AThrowingHook_HoldsTheBatchForRetry_ThenForcesTheDeletePastTheCapAsync, DapperEphemeralDestructionHookTests.EmptyBatches_OpenNothing_AndCountNoFailureAsync}

The ephemeral reap honors a registered `IDestructionHook` on the Dapper Postgres driver exactly as it does on the
EF Core driver: the hook is offered the bodies the reap then deletes, a `Canceled` or `Defer` holds them, a body that
becomes eligible while the hook runs waits for the next cycle, and a throwing hook holds the batch for retry under the
`OnDestroyFailure` policy (#2039).

:::updated
Earlier releases left the reap's destruction seam unimplemented on the Dapper driver. A Dapper host with a hook
registered was offered nothing and never asked, while the maintenance cycle reaped every eligible body. A hook used for
compliance or export saw none of the deleted bodies.
:::

| Choice | Reason | Verified |
|---|---|---|
| The Dapper driver runs the reap's destruction seam (the batch it offers, the hold a `Canceled` or `Defer` records, the failure count a throwing hook records, and the reap restricted to the batch) from the same SQL as the EF Core driver, one shared copy qualified with each driver's schema. | One copy cannot drift. The batch is the reap's own predicate read as a `SELECT`, so a second hand-written copy would sooner or later offer bodies the reap keeps or miss bodies it deletes, on one driver only. | {verified: DapperEphemeralDestructionHookTests.AConsumedAgedBody_IsOfferedToTheHook_ThenReaped_AndAnnouncedAsync, EphemeralDestructionTargetSqlTests.GetEphemeralBodiesAboutToReap_AnAfterTtlBodyNotYetExpired_IsNotOffered_AndOfferedMatchesDeletedAsync} |
| The driver honors the hook rather than refusing to start when one is registered. | A host that chose Dapper should get the same compliance and export guarantee as one on EF Core; a startup refusal would only move the gap from silent to loud. | {verified: DapperEphemeralDestructionHookTests.AHookThatCancels_KeepsTheBody_AndIsNotOfferedItAgainWhileTheHoldStandsAsync, DapperEphemeralDestructionHookTests.AThrowingHook_HoldsTheBatchForRetry_ThenForcesTheDeletePastTheCapAsync} |
| An empty batch (nothing to hold, no failure to count) returns before a connection is opened. | Most cycles have nothing to hold, and opening a connection to do nothing costs a pool slot on every one of them. | {verified: DapperEphemeralDestructionHookTests.EmptyBatches_OpenNothing_AndCountNoFailureAsync} |

Each Dapper test has a twin on the EF Core driver, so the two drivers are held to one contract. Locked by
[`DapperEphemeralDestructionHookTests`](https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.Dapper.Postgres.Tests/DapperEphemeralDestructionHookTests.cs),
[`EphemeralDestructionTargetSqlTests`](https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralDestructionTargetSqlTests.cs),
[`EphemeralDestructionHoldSqlTests`](https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralDestructionHoldSqlTests.cs)
and [`EphemeralReapSeenSetTests`](https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralReapSeenSetTests.cs).

The other places a destruction hook is consulted, by driver:

| Destruction path | EF Core driver | Dapper driver |
|---|---|---|
| Ephemeral body reap (this page) | Hook honored | Hook honored (#2039) |
| [Scheduled disposition](stream-end-of-life#scheduled-disposition) of a sealed or policy-picked stream: archive, delete, compact | Hook honored | Hook honored: the step is shared code that both drivers register {verified: StreamDispositionStepTests.AHookThatCancels_DefersForTheBackoff_AndOneThatDefers_MovesTheDueTimeToItsInstantAsync, DapperStreamDispositionTests.AddWhizbangPostgres_RegistersTheLedgerAndTheStep_AndTheStepArchivesASealedStreamOnceItsGraceHasPassedAsync} |
| Prefix truncate that archives (through the [archive store](archive-store)) | Hook honored | Hook honored |
| Prefix truncate that discards the detail (a delete, a [compaction](#compaction), a version-cap cut) | Hook honored | Hook honored: the Dapper coordinator runs the same truncate SQL (#2043) {verified: DapperStreamPrefixTruncateTests.Truncator_AHookToldProceed_SeesTheDetailActuallyTruncated_AndIsAnnouncedAsync} |
| [Scheduled prefix truncate](#scheduled-close) | Hook honored | Hook honored: both drivers register the receptor (#2043) {verified: DapperScheduledPrefixTruncateTests.AFiredOccurrence_OnADapperHost_TruncatesTheStreamAsync} |

Earlier releases left the last two rows unsupported on the Dapper driver: the hook was consulted, then the coordinator
answered `unsupported` and nothing was truncated, and no receptor handled a scheduled truncate. See
[the prefix truncate on every data layer](event-streams#prefix-truncate-on-every-data-layer).

## Compacting a stream {#compaction}

`IStreamCompactor.CompactAsync(streamId, perspectiveName)` folds a state-based stream into a single
summary. It reads the perspective's latest snapshot, appends a `Compacted` event carrying that model
at the head of the stream, then truncates everything up to the snapshot's event through the stream
closer (discarding it, since ephemeral detail has nothing to archive). The summary is written before
the truncate, so a failed truncate loses nothing. With no snapshot the result is `no_snapshot` and
nothing is appended; if the truncate is refused, its status is returned.
{verified: StreamCompactorTests.Compact_HappyPath_AppendsCompactedOriginThenTruncatesThroughAnchorAsync, StreamCompactorTests.Compact_NoSnapshot_ReturnsNoSnapshot_AppendsNothingAsync, StreamCompactorTests.Compact_CloseBlocked_SurfacesCloseStatusAsync}

`Compacted` is flagged `EventFlags.Compacted`, not `Ephemeral`. It is state-based, so rebuilds refuse
the stream, but the reaper never deletes it: it is the permanent origin the stream now replays from.
{verified: EphemeralFlagDeriverTests.Derive_RealCompactedEvent_IsCompactedAsync, EphemeralStreamGuardSqlTests.StateBased_IncludesCompacted_ButReaperDoesNotReapItAsync}

`AddWhizbangWorkers()` registers `IStreamCompactor` and `IStreamPrefixTruncator`; both run only when called.

## Truncating a stream on a schedule {#scheduled-close}

A prefix truncate removes a stream's history below a point and keeps a carry-forward event above it (see
[Truncating a Stream's Prefix](event-streams#truncating-a-stream-prefix)). `IStreamPrefixTruncator.TruncateAsync` wraps that
truncate in the same destruction hook the reaper uses, with reason `PeriodClose`. A hook that cancels or
defers vetoes the truncate, and a hook that throws aborts it without truncating anything.
{verified: StreamPrefixTruncatorTests.Truncate_HookProceeds_FiresBeforeThenCloseThenAfterAsync, StreamPrefixTruncatorTests.Truncate_HookCancels_DoesNotTruncateAsync, StreamPrefixTruncatorTests.Truncate_HookDefers_DoesNotTruncateAsync, StreamPrefixTruncatorTests.Truncate_PreHookThrows_AbortsWithoutTruncatingAsync}

The truncate also runs the [destruction lifecycle stages](../lifecycle/lifecycle-stages#destruction) for the
events it truncates, as the reaper does for the bodies it deletes: the events at or below the truncate
point whose type has a destruction-stage receptor are loaded first, the Pre stages run before the
truncate (a throwing `PreDestructionInline` receptor aborts the truncate, as a throwing hook does), and the
Post stages run with the same envelopes after a truncate that removed events.
{verified: StreamPrefixTruncatorDestructionStageComponentTests.Truncate_RunsThePreStagesBeforeTheTruncateAndThePostStagesAfterItAsync, StreamPrefixTruncatorDestructionStageComponentTests.AThrowingPreInlineReceptor_VetoesTheCloseAsync, StreamPrefixTruncatorDestructionStageComponentTests.ACloseThatTruncatesNothing_RunsNoPostStageAsync}

Mark a perspective `[FullHistory]` when it needs every event and cannot resume from a carry-forward
(a list of every transaction, as opposed to a balance). A **discarding** truncate of a stream that such a
perspective consumes is refused with status `full_history_blocked`; an archiving truncate is allowed,
because the detail stays retrievable.
{verified: StreamPrefixTruncatorTests.Truncate_DiscardWithFullHistoryConsumer_IsRefusedAsync, StreamPrefixTruncatorTests.Truncate_ArchiveWithFullHistoryConsumer_IsAllowedAsync, StreamPrefixTruncatorTests.Truncate_DiscardWithResumableConsumerOnly_ProceedsAsync}

### Scheduling a prefix truncate {#scheduling-a-prefix-truncate}

To truncate on a schedule (every month, say), build a recurring schedule whose occurrences are
`ScheduledPrefixTruncate(StreamId, ThroughVersion, Archive)` commands. `PrefixTruncateSchedule.Recurring`
takes a fixed interval and `PrefixTruncateSchedule.RecurringCron` a cron expression and optional time
zone; pass the resulting `ScheduleDefinition` to `IScheduleManager.CreateAsync`. Keep the occurrences
in a dedicated control stream, separate from the stream being truncated. The cut, `ThroughVersion`, is
yours to advance each period.
{verified: PrefixTruncateScheduleTests.Recurring_BuildsIntervalDefinition_PayloadRoundTripsAsync, PrefixTruncateScheduleTests.RecurringCron_BuildsCronDefinitionAsync}

```csharp{title="A monthly prefix-truncate schedule" description="A cron schedule that fires a ScheduledPrefixTruncate at midnight on the first of each month, New York time." framework="NET10" category="Core Concepts" difficulty="ADVANCED" tags=["prefix-truncate", "schedules", "archival"] testFile="PrefixTruncateScheduleTests.cs" testMethod="RecurringCron_BuildsCronDefinitionAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Core.Tests/Archival/PrefixTruncateScheduleTests.cs" tests=["PrefixTruncateScheduleTests.RecurringCron_BuildsCronDefinitionAsync"]}
var def = PrefixTruncateSchedule.RecurringCron(
  "truncate-month", Guid.NewGuid(), new ScheduledPrefixTruncate(Guid.NewGuid(), 100, false),
  "0 0 1 * *", Guid.NewGuid(), timeZone: "America/New_York");
```

On either Postgres driver (EF Core or Dapper) a built-in receptor handles each `ScheduledPrefixTruncate` by calling
`IStreamPrefixTruncator.TruncateAsync` with its values. It is registered at startup at the `LocalImmediateInline`,
`PreOutboxInline` and `PostInboxInline` stages, so it runs whether the occurrence fires in this
process or arrives from another service. With no `IStreamPrefixTruncator` registered it logs a warning and does
nothing.
{verified: ScheduledPrefixTruncateReceptorTests.Receptor_FiredOccurrence_CallsStreamPrefixTruncatorWithPayloadAsync, ScheduledPrefixTruncateReceptorTests.Registrar_RegistersReceptorAtThreeDefaultStagesAsync, ScheduledPrefixTruncateReceptorTests.Receptor_NoStreamPrefixTruncatorRegistered_IsInertAsync, DapperScheduledPrefixTruncateTests.AFiredOccurrence_OnADapperHost_TruncatesTheStreamAsync}

| Choice | Reason | Verified |
|---|---|---|
| The types are named for what they do: `ScheduledPrefixTruncate`, `PrefixTruncateSchedule` and `ScheduledPrefixTruncateReceptor` (they were `ScheduledStreamClose`, `StreamCloseSchedule` and `ScheduledStreamCloseReceptor` until #1760). | "Close" belongs to closing the books, which ends a stream and opens its successor; these types only truncate a prefix. | {verified: ScheduledPrefixTruncateRenameTests.TheOccurrenceType_IsNamedForThePrefixTruncate_AndItsFormerName_StillResolvesToItAsync} |
| The former name `Whizbang.Core.Archival.ScheduledStreamClose` is kept in the pinned-type ledger's `formerNames`, so it resolves to `ScheduledPrefixTruncate`; the payload's fields kept their names. | A schedule stores its occurrence's type name and payload; a schedule created before the rename must still fire. A new schedule stores the new name. | {verified: ScheduledPrefixTruncateRenameTests.AnOccurrenceStoredUnderTheFormerName_LoadsAsTheRenamedType_WithItsValues_AndANewScheduleStoresTheNewNameAsync} |

## Related

- [WHIZ130: Perspective mixes ephemeral and Sourced Apply methods](../../operations/diagnostics/whiz130)
- [WHIZ131: Rebuild or rewind of an ephemeral-only perspective](../../operations/diagnostics/whiz131)
- [WHIZ132: Receptor turns an ephemeral message into a Sourced event](../../operations/diagnostics/whiz132)
- [WHIZ134: Ambiguous ephemeral composition](../../operations/diagnostics/whiz134)
- [Perspective Row Retention](../perspectives/row-retention)
- [Perspective Snapshots](../perspectives/snapshots)
- [Event Streams: closing a stream's history](event-streams#truncating-a-stream-prefix)
- [Lifecycle Stages: destruction stages](../lifecycle/lifecycle-stages#destruction)
- [Configuration reference: EphemeralOptions](../../operations/configuration/configuration-reference#ephemeraloptions)
