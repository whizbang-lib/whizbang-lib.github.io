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
  the read model, the WHIZ130 and WHIZ134 build rules, the runtime guards, compaction and scheduled
  stream closes.
tags: >-
  events, ephemeral, destruction, transient-storage, ttl, rewind-grace, reaper, snapshots, composition,
  profiles, WHIZ130, WHIZ134, compaction, stream-close, full-history
codeReferences:
  - src/Whizbang.Core/Attributes/EphemeralAttribute.cs
  - src/Whizbang.Core/Attributes/Destruction.cs
  - src/Whizbang.Core/Attributes/TransientStorage.cs
  - src/Whizbang.Core/Attributes/EphemeralInfo.cs
  - src/Whizbang.Core/Attributes/DangerouslyAllowMixedEphemeralAndSourcedEventsAttribute.cs
  - src/Whizbang.Core/Attributes/FullHistoryAttribute.cs
  - src/Whizbang.Core/IEphemeralEvent.cs
  - src/Whizbang.Core/ICompactedEvent.cs
  - src/Whizbang.Core/EphemeralModeResolver.cs
  - src/Whizbang.Core/Messaging/EphemeralFlagDeriver.cs
  - src/Whizbang.Core/Messaging/EphemeralTtlDeriver.cs
  - src/Whizbang.Core/Messaging/EventFlags.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Observability/EnvelopeMetadata.cs
  - src/Whizbang.Core/Lifecycle/Destruction.cs
  - src/Whizbang.Core/Lifecycle/OnDestroyFailure.cs
  - src/Whizbang.Core/Lifecycle/IDestructionHook.cs
  - src/Whizbang.Core/Lifecycle/StreamCloser.cs
  - src/Whizbang.Core/Perspectives/Compacted.cs
  - src/Whizbang.Core/Perspectives/StreamCompactor.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRebuilder.cs
  - src/Whizbang.Core/Perspectives/PerspectiveSnapshotOptions.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTtlRegistry.cs
  - src/Whizbang.Core/Perspectives/FullHistoryPerspectiveRegistry.cs
  - src/Whizbang.Core/Archival/ScheduledStreamClose.cs
  - src/Whizbang.Core/Archival/StreamCloseSchedule.cs
  - src/Whizbang.Core/Configuration/EphemeralOptions.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Data.EFCore.Postgres/ScheduledStreamCloseReceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/ScheduledStreamCloseReceptorRegistrar.cs
  - src/Whizbang.Generators/EphemeralAnalyzer.cs
  - src/Whizbang.Generators/Utilities/EphemeralResolver.cs
  - src/Whizbang.Generators/PerspectiveRunnerGenerator.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
testReferences:
  - tests/Whizbang.Core.Tests/Attributes/EphemeralAttributeTests.cs
  - tests/Whizbang.Core.Tests/Ephemeral/EphemeralModeResolverTests.cs
  - tests/Whizbang.Core.Tests/Ephemeral/EphemeralFlagDeriverTests.cs
  - tests/Whizbang.Core.Tests/Ephemeral/EphemeralTtlDeriverTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/EvictedRowRebuildTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/StreamCompactorTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/FullHistoryPerspectiveRegistryTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/StreamCloserTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/DestructionContractTests.cs
  - tests/Whizbang.Core.Tests/Archival/StreamCloseScheduleTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerDestructionHookTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerReapDrivenSnapshotTests.cs
  - tests/Whizbang.Core.Tests/Fingerprint/TypeDefinitionReconcilerBranchCoverageTests.cs
  - tests/Whizbang.Generators.Tests/EphemeralAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/EphemeralAnalyzerOptInNameTests.cs
  - tests/Whizbang.Generators.Tests/EphemeralResolverCoverageTests.cs
  - tests/Whizbang.Generators.Tests/MessageTypeCatalogEphemeralTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerTemplateInvariantTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralBodyOffloadSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralBodyReaperSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralDestructionHoldSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralEventStoreReadTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralSnapshotTargetSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EphemeralStreamGuardSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ScheduledStreamCloseReceptorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TypeDefinitionReconcilerTests.cs
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
| `OnCompaction` | **Planned.** Declared for events whose detail is folded into a compacted summary; nothing acts on the mode yet, so the body is reaped like a `WhenConsumed` event. Compaction itself is started explicitly; see [Compacting a stream](#compaction). The mode is planned with the storage work on archive policies and closing the books. |
| `Archived` | **Planned.** Declared for detail that moves to cold storage; nothing acts on the mode yet, so the body is reaped like a `WhenConsumed` event. Archiving happens through a stream close with `archive: true`; see [Closing a stream on a schedule](#scheduled-close). The mode is planned with the storage work on archive policies. |

{verified: EphemeralAttributeTests.Destruction_HasTheFourStrategiesAsync, EphemeralTtlDeriverTests.Derive_AfterTtl_ReturnsTtlSecondsAsync, EphemeralTtlDeriverTests.Derive_WhenConsumed_NoTtl_IsNullAsync, EphemeralBodyReaperSqlTests.Reap_AfterTtl_StampedExpiry_HeldUntilPast_ThenReapedAsync, EphemeralBodyReaperSqlTests.Reap_ExpiryKeyIsTheDiscriminator_AfterTtlHeldWhileWhenConsumedReapsAsync}

The expiry is derived from `TtlSeconds`, so give `AfterTtl` events a `TtlSeconds`; without one they
reap like `WhenConsumed` events, as soon as they are consumed. That is deliberate, not a missing check. Declaring `OnCompaction` or `Archived` does not by itself compact or
archive anything. On the receive side the TTL is resolved from the message's wire type name, so an
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

## Build-time rules

The `EphemeralAnalyzer` checks the two rules that can be decided from type symbols alone.

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

### WHIZ134: ambiguous composition {#whiz134}

A type that inherits `[Ephemeral]` from two or more sibling profile interfaces whose `Destruction` or
`Storage` differ, with no attribute on the type or a base class to settle it, is an **error**,
[WHIZ134](../../operations/diagnostics/whiz134). Profiles that agree, or a profile that extends the
other, are fine. Declaring `[Ephemeral(...)]` on the type resolves it.

:::planned
Three more build rules are planned: one for a rebuild or rewind of a perspective that applies only
ephemeral events, one for a receptor that copies an ephemeral event into a Sourced event, and one for a
stream that receives both kinds. Until they ship, the runtime guards below are the backstop.
:::
{verified: EphemeralAnalyzerTests.TwoConflictingProfiles_ReportsWHIZ134ErrorAsync, EphemeralAnalyzerTests.TwoAgreeingProfiles_NoWHIZ134Async, EphemeralAnalyzerTests.RefinedProfileInheritance_NoWHIZ134Async, EphemeralAnalyzerTests.ConflictingProfilesWithOwnOverride_NoWHIZ134Async}

## Runtime guards

Some misuses only show up at run time: a rebuild that names a stream by id, or an event that arrives
after its predecessors' bodies are gone. These guards cover them.

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
effect on earlier state is the accepted loss of arriving outside the grace window.
{verified: PerspectiveRunnerGeneratorTests.PerspectiveRunnerGenerator_EphemeralPerspective_GuardsRewindFallbackAgainstReapedBodiesAsync, PerspectiveRunnerTemplateInvariantTests.EphemeralRewind_GuardsFullReplayFallbackAgainstReapedBodiesAsync}

**Evicted rows rebuild only from a snapshot.** When retention evicts an ephemeral perspective's row
and a later event arrives, the row is restored from its snapshot and the events after it. With no
snapshot to restore, the row starts fresh from the new event and a warning is logged, because the
earlier history is gone.
{verified: EvictedRowRebuildTests.EphemeralPerspective_EvictedRowWithSnapshot_RestoresTheSnapshotAndReplaysTheTailAsync, EvictedRowRebuildTests.EphemeralPerspective_EvictedRowWithoutSnapshot_StartsFreshAndWarnsAsync}

**Making an existing type ephemeral.** Events stored before a type gained `[Ephemeral]` are still
Sourced. At startup the type-definition reconciler detects this and logs it. Set
`Whizbang:Ephemeral:ReconcileHistoricalOnStartup` to `true` to have it reclassify that history as
ephemeral, which makes it reapable; by default it only reports.
{verified: TypeDefinitionReconcilerTests.Reconcile_SettingsDriftToEphemeral_ActEnabled_ReclassifiesAndRecordsLineageAsync, TypeDefinitionReconcilerTests.Reconcile_SettingsDrift_DetectOnly_RecordsLineageButDoesNotReclassifyAsync}

## Destruction hooks {#destruction-hooks}

Register an `IDestructionHook` to act on bodies before they are deleted: write a summary, archive
them, or decide to keep them. The maintenance worker calls `OnBeforeDestructionAsync` **once per
cycle** with every event it is about to reap in `DestructionContext.Targets`, before the delete, and
`OnAfterDestructionAsync` after the delete has committed.
{verified: MaintenanceWorkerDestructionHookTests.RunMaintenanceOnce_HookRegistered_FiresOnceForTheBatchBeforeReapThenAfterAsync}

The hook returns a `DestructionResult`:

| Result | Effect |
|---|---|
| `DestructionResult.Proceed()` | The batch is deleted. |
| `DestructionResult.Canceled` | The whole batch is held indefinitely. Nothing is deleted and the after-hook does not run. |
| `DestructionResult.Defer(until)` | The batch is held until `until`, then offered again. |

{verified: MaintenanceWorkerDestructionHookTests.RunMaintenanceOnce_HookCancels_HoldsBatchFarFuture_NoPostDestructionAsync, MaintenanceWorkerDestructionHookTests.RunMaintenanceOnce_HookDefers_HoldsBatchUntilInstant_NoPostDestructionAsync, DestructionContractTests.DestructionResult_Proceed_DefaultsToDeleteAsync}

If the hook throws, the batch is held for a backoff (`DestructionRetryBackoffSeconds`) and offered
again, up to `MaxDestructionRetries` times. What happens after that is the `OnDestroyFailure` policy on the
maintenance worker options: `RetryThenForcedDelete` (the default) deletes anyway, so a broken hook
cannot leak storage; `RetryThenKeep` keeps the data; `ForceDeleteImmediately` deletes on the first
failure. See [MaintenanceWorkerOptions](../../operations/configuration/configuration-reference#maintenanceworkeroptions)
and the [destruction lifecycle stages](../lifecycle/lifecycle-stages#destruction).
{verified: MaintenanceWorkerDestructionHookTests.RunMaintenanceOnce_HookThrows_RecordsFailureForRetry_NoPostDestructionAsync, EphemeralDestructionHoldSqlTests.RecordDestructionFailure_HoldsForRetry_ThenForcedDeletePastCapAsync, EphemeralDestructionHoldSqlTests.RecordDestructionFailure_RetryThenKeep_KeepsPastCapAsync, EphemeralDestructionHoldSqlTests.RecordDestructionFailure_ForceDeleteImmediately_ReapsOnFirstFailureAsync}

A hook can preserve data or emit ephemeral events, but it cannot turn an ephemeral event back into a
durable Sourced one; there is no "promote" result.

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

`AddWhizbangWorkers()` registers `IStreamCompactor` and `IStreamCloser`; both run only when called.

## Closing a stream on a schedule {#scheduled-close}

Closing a stream truncates its history below a point and keeps a carry-forward event above it (see
[Closing a Stream's History](event-streams#closing-a-stream)). `IStreamCloser.CloseAsync` wraps that
close in the same destruction hook the reaper uses, with reason `PeriodClose`. A hook that cancels or
defers vetoes the close, and a hook that throws aborts it without truncating anything.
{verified: StreamCloserTests.Close_HookProceeds_FiresBeforeThenCloseThenAfterAsync, StreamCloserTests.Close_HookCancels_DoesNotTruncateAsync, StreamCloserTests.Close_HookDefers_DoesNotTruncateAsync, StreamCloserTests.Close_PreHookThrows_AbortsWithoutTruncatingAsync}

Mark a perspective `[FullHistory]` when it needs every event and cannot resume from a carry-forward
(a list of every transaction, as opposed to a balance). A **discarding** close of a stream that such a
perspective consumes is refused with status `full_history_blocked`; an archiving close is allowed,
because the detail stays retrievable.
{verified: StreamCloserTests.Close_DiscardWithFullHistoryConsumer_IsRefusedAsync, StreamCloserTests.Close_ArchiveWithFullHistoryConsumer_IsAllowedAsync, StreamCloserTests.Close_DiscardWithResumableConsumerOnly_ProceedsAsync}

To close on a schedule ("close the month"), build a recurring schedule whose occurrences are
`ScheduledStreamClose(StreamId, ThroughVersion, Archive)` commands. `StreamCloseSchedule.Recurring`
takes a fixed interval and `StreamCloseSchedule.RecurringCron` a cron expression and optional time
zone; pass the resulting `ScheduleDefinition` to `IScheduleManager.CreateAsync`. Keep the occurrences
in a dedicated control stream, separate from the stream being closed. The close point,
`ThroughVersion`, is yours to advance each period.
{verified: StreamCloseScheduleTests.Recurring_BuildsIntervalDefinition_PayloadRoundTripsAsync, StreamCloseScheduleTests.RecurringCron_BuildsCronDefinitionAsync}

```csharp{title="A monthly close schedule" description="A cron schedule that fires a ScheduledStreamClose at midnight on the first of each month, New York time." framework="NET10" category="Core Concepts" difficulty="ADVANCED" tags=["stream-close", "schedules", "archival", "close-the-books"] testFile="StreamCloseScheduleTests.cs" testMethod="RecurringCron_BuildsCronDefinitionAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Core.Tests/Archival/StreamCloseScheduleTests.cs" tests=["StreamCloseScheduleTests.RecurringCron_BuildsCronDefinitionAsync"]}
var def = StreamCloseSchedule.RecurringCron(
  "close-month", Guid.NewGuid(), new ScheduledStreamClose(Guid.NewGuid(), 100, false),
  "0 0 1 * *", Guid.NewGuid(), timeZone: "America/New_York");
```

On the Postgres EF Core driver a built-in receptor handles each `ScheduledStreamClose` by calling
`IStreamCloser.CloseAsync` with its values. It is registered at startup at the `LocalImmediateInline`,
`PreOutboxInline` and `PostInboxInline` stages, so it runs whether the occurrence fires in this
process or arrives from another service. With no `IStreamCloser` registered it logs a warning and does
nothing.
{verified: ScheduledStreamCloseReceptorTests.Receptor_FiredOccurrence_CallsStreamCloserWithPayloadAsync, ScheduledStreamCloseReceptorTests.Registrar_RegistersReceptorAtThreeDefaultStagesAsync, ScheduledStreamCloseReceptorTests.Receptor_NoStreamCloserRegistered_IsInertAsync}

## Related

- [WHIZ130: Perspective mixes ephemeral and Sourced Apply methods](../../operations/diagnostics/whiz130)
- [WHIZ134: Ambiguous ephemeral composition](../../operations/diagnostics/whiz134)
- [Perspective Row Retention](../perspectives/row-retention)
- [Perspective Snapshots](../perspectives/snapshots)
- [Event Streams: closing a stream's history](event-streams#closing-a-stream)
- [Lifecycle Stages: destruction stages](../lifecycle/lifecycle-stages#destruction)
- [Configuration reference: EphemeralOptions](../../operations/configuration/configuration-reference#ephemeraloptions)
