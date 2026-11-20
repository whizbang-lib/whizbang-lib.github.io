---
title: Retired Event Types
pageType: concept
description: >-
  When an application deletes an event type, name it under Whizbang:EventStore:RetiredTypes and its stored events are
  purged from every stream, including long-lived streams it shares with types that stay, a bounded batch at a time.
  A retired type is an eligibility rule: no integrity digest counts it on either side of a service pair, and the
  receive boundary turns it away.
version: 1.0.0
category: Core Concepts
order: 19
tags: 'events, retired, deleted types, purge, maintenance, storage, integrity, rule fingerprint'
codeReferences:
  - src/Whizbang.Core/Messaging/RetiredEventTypesOptions.cs
  - src/Whizbang.Core/Messaging/RuleFingerprintSource.cs
  - src/Whizbang.Core/Routing/MessageDiscardPolicy.cs
  - src/Whizbang.Core/Routing/MessageDiscardReason.cs
  - src/Whizbang.Core/Workers/ReceiveConsumerGate.cs
  - src/Whizbang.Core/Configuration/ProcessWideOptionsBinding.cs
  - src/Whizbang.Rules/TypeRules.cs
  - src/Whizbang.Rules/RuleSemantics.cs
  - src/Whizbang.Data.Postgres/RetiredEventTypePurgeStep.cs
  - src/Whizbang.Data.Postgres/Migrations/538_RemovalsHandOnCursorsThroughOneHelper.sql
  - src/Whizbang.Data.Postgres/Migrations/539_RetiredEventTypesArePurgedByName.sql
testReferences:
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/RetiredEventTypesOptionsTests.cs
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/CatalogRuleFingerprintSourceTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Routing/MessageDiscardPolicyTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Workers/ReceiveConsumerGateTests.cs
  - tests/Whizbang.Core.Tests/Rules/TypeRulesTests.cs
  - tests/Whizbang.Core.Tests/Configuration/ProcessWideOptionsBindingTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RetiredEventTypePurgeSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RetiredEventTypePurgeStepTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CleanupIntegrityMatrixTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperRetiredEventTypePurgeTests.cs
---

# Retired Event Types

An application deletes an event type when nothing reads it any more. Its stored events stay behind: a stream-level
policy ([end of life](stream-end-of-life)) reaches a type only through the type that opens its streams, so a deleted
type on long-lived streams it shares with types that stay keeps its events for good.

Naming the type as **retired** removes them. The maintenance cycle purges every stored event of the type, by its name,
whether or not its class still exists anywhere, from every stream, and leaves the other types in those streams as they
were.

## Declaring a retired type {#declaring-a-retired-type}

{verified: ProcessWideOptionsBindingTests.RetiredEventTypes_BindFromTheirSection_AndValidateAtStartupAsync, RetiredEventTypesOptionsTests.RetiredNames_AreTheNamesWithoutTheirAssembly_OnceEach_InOrdinalOrderAsync}

Name the type, without its assembly, under `Whizbang:EventStore:RetiredTypes:Names`:

```json{
title: "Retire a deleted event type"
description: "Names a deleted event type so the maintenance cycle purges its stored events and integrity stops counting it."
category: "Configuration"
difficulty: "BEGINNER"
tags: ["retired-types", "configuration", "event-store", "purge"]
}
{
  "Whizbang": {
    "EventStore": {
      "RetiredTypes": {
        "Names": [ "MyApp.Orders.CouponIssued" ]
      }
    }
  }
}
```

That is all it takes: the Postgres drivers (EF Core and Dapper) register the purge, and the integrity and receive
paths read the same setting. Nothing else is configured or called.

- **Declare it in every service that stores the type.** A retired type is an eligibility rule, part of the type's
  [rule fingerprint](../../resilience/stream-integrity#rule-fingerprint). Two services that disagree on it halt their
  pair through the [pair guard](../../resilience/stream-integrity#the-pair-guard) until both declare it, so a rollout
  that has reached only one of them compares nothing for the type instead of repairing a difference that is deliberate.
- **Retire a type only once it is deleted.** A name this service still declares as an event type is not retired here:
  its events are neither purged nor turned away at receive, and it keeps its declared rules in the rule fingerprint.
  Every maintenance cycle, the first one after the host starts included, logs a warning naming it until the type is
  deleted here or the name removed.
- **A name nothing is stored under is reported** once a process, by the first maintenance cycle: the name is
  misspelled, or the type's history is already purged here. A name is matched without its assembly, under every
  assembly it was stored with.

| Choice | Reason | Verified |
|---|---|---|
| A retirement is declared in configuration, by name, not with an attribute. | The type's class is deleted, so there is nothing left to put an attribute on, and the stored name is the one thing that still identifies its events. The rule still travels in the rule fingerprint like every other rule, so two services cannot quietly disagree. | {verified: CatalogRuleFingerprintSourceTests.For_CoversEachRetiredName_AsRetired_ThoughTheCatalogNoLongerDeclaresItAsync} |
| A name this service still declares is warned about and skipped, not refused at startup. | A running service must never purge, or turn away, events its own readers still apply; but a service on an older contracts package that still has the type should keep running while the rollout reaches it. The skipped name is counted in the cycle's result and warned about every cycle, so it is never silent. | {verified: RetiredEventTypePurgeStepTests.Purge_SkipsANameThisServiceStillDeclares_CountsIt_AndWarnsEveryCycleAsync, RetiredEventTypesOptionsTests.EffectiveNames_LeaveOutANameThisServiceStillDeclares_AndStillDeclaredNamesItAsync, MessageDiscardPolicyTests.EvaluateReceive_ARetiredNameThisServiceStillDeclares_IsNotTurnedAwayAsync, CatalogRuleFingerprintSourceTests.RulesOf_ARetiredNameTheCatalogStillDeclares_KeepsItsDeclaredRulesAsync} |
| An unknown name is reported, not refused. | Once a type's history is fully purged the name matches nothing, and the entry must stay while any peer still stores the type, so "nothing stored" is not an error. | {verified: RetiredEventTypePurgeStepTests.Purge_ReportsANameNothingIsStoredUnder_OnceAProcess_AndTheWaitingStreamsAsync} |

## What the purge does {#what-the-purge-does}

{verified: RetiredEventTypePurgeSqlTests.Retire_RemovesEveryEventOfTheType_FromAMixedStream_AndTheOtherTypesStayAsync, RetiredEventTypePurgeSqlTests.Retire_UnfoldsTheTypeFromTheDigests_SoTheyEqualARecount_AndRefoldsAndBumpsOnceAsync, RetiredEventTypePurgeStepTests.Purge_RunsBatchesWithinTheCycleBudget_AndTheNextCycleTakesTheRestAsync}

The maintenance step (`RetiredEventTypePurgeStep`) runs in the maintenance cycle, idle-gated and under the maintainer
turn, so startup never waits on it. Each cycle it runs up to `MaxBatchesPerCycle` batches (`wh_retire_event_types`),
each its own transaction, each taking up to `BatchStreams` streams that hold a retired event. For each batch:

1. The retired names are resolved to the names their events are stored under, one index probe per distinct stored
   type, never a scan of events.
2. The streams are locked with the emit chains' per-stream locks, as every removal locks them.
3. A [cursor](#cursors-and-snapshots) resting on a retired event is handed on.
4. The events leave their stream digests through the one digest fold. The type's buckets in those streams go, with what
   [cuts carried](../../resilience/stream-integrity#cuts-carry-their-digest) into them, and so do its removed-epoch
   rows.
5. The sealed epochs the events sat in are refolded, and the origin generation is bumped once, floored at the lowest
   position touched, so consumers lower their seals that far and verify again instead of alarming.
6. Each event goes with its body, its perspective work, its applied record, its lifecycle completion, a lapsed hold and
   its superseded-queue row. Its deduplication row stays, so a resend of it is still recognized.

A stream leaves whole or waits whole. Its retired events wait while the commit-order stamper has not reached one, while
a [destruction hold](ephemeral-events) is active on one, or while a snapshot or a cursor rests on one; the other streams
of the batch go on. A waiting stream is counted and left, never forced: the count is in each cycle's log line
("n streams wait for a destruction hold, a snapshot, the commit-order stamper or a perspective cursor") and in the
step's result (`StreamsWaiting`), so a stream that can never progress is seen rather than silent. A
superseding retired type counts its key once, as its slot: the whole stream leaves, so each slot is unfolded once, and a
key whose copies of another type of its group stay keeps its slot, handed on to them.

Under `debug_mode` nothing is purged, as with every other reaper.

| Choice | Reason | Verified |
|---|---|---|
| A retirement unfolds, refolds and bumps the generation, unlike a cut, which carries. | Retiring a type is a rule change: what should be counted changed, on every side that runs the rule. A cut is timing, local to one service, so it carries; a rule change moves what is counted, once. | {verified: RetiredEventTypePurgeSqlTests.Retire_UnfoldsTheTypeFromTheDigests_SoTheyEqualARecount_AndRefoldsAndBumpsOnceAsync, RetiredEventTypePurgeSqlTests.Retire_DropsWhatACutCarriedForTheType_AndItsRemovedEpochRowsAsync} |
| A stream leaves whole or waits whole. | A superseding key keeps all its copies or none, so its slot is unfolded exactly once, and a stream is never left half retired. | {verified: RetiredEventTypePurgeSqlTests.Retire_AStreamAGateHolds_WaitsWhole_AndTheOthersAreRetiredAsync, RetiredEventTypePurgeSqlTests.Retire_ASupersedingType_UnfoldsEachKeysSlotOnce_AndASlotSharedWithAStayingTypeIsHandedOnAsync} |
| The batch is chosen by stream, not by a cursor walked through the type's history. | A held stream must be revisited once its hold lapses; a commit-order cursor would pass it by and never return. | {verified: RetiredEventTypePurgeSqlTests.Retire_AStreamAGateHolds_WaitsWhole_AndTheOthersAreRetiredAsync} |
| Work queued for a retired event, and a lapsed hold, go with it. | No reader can apply a type that no longer exists, so its work would hold the event forever. An active hold is honored, as by every other removal. | {verified: RetiredEventTypePurgeSqlTests.Retire_TakesTheEventsCompanionRows_AndKeepsTheirDeduplicationAsync} |
| Batches are bounded by streams and by batches a cycle. | The cost of a cycle is the batch's streams, whatever the size of the store. | {verified: RetiredEventTypePurgeSqlTests.Retire_TakesAtMostTheBatchOfStreams_AndTheNextBatchTakesTheRestAsync} |

## Cursors and snapshots {#cursors-and-snapshots}

{verified: RetiredEventTypePurgeSqlTests.Retire_ACursorOnARetiredEvent_StepsBackToTheEventBeforeIt_AndTheStreamIsPurgedAsync, RetiredEventTypePurgeSqlTests.Retire_ACursorWithNoEarlierEventToStepBackTo_KeepsTheStreamWaitingAsync, RetiredEventTypePurgeSqlTests.Retire_ACursorWithOtherWorkPendingBeforeIt_KeepsTheStreamWaitingAsync}

A perspective cursor names the last event its perspective applied. A cursor resting on a retired event steps back to
the stream's last event before it, which the perspective applied too: the same hand-on the
[superseding reaper](superseding-events#the-reaper) uses (`_wh_hand_on_cursors`), shared rather than copied. It waits,
and keeps its stream waiting, when:

- the perspective has other work pending at or before the retired event;
- the cursor is flagged for a rewind, which places it;
- no event comes before the retired one in the stream (a retired type that opened the stream).

A snapshot resting on a retired event keeps its stream waiting until a newer snapshot replaces it: a rewind restores the
snapshot and moves the cursor onto its event.

A cursor with no earlier event to step back to, and a snapshot that is never replaced, keep their stream waiting for
good. Such streams are counted and left as they are, by design: the count is in every cycle's log line, so they can be
dealt with by hand. {verified: RetiredEventTypePurgeSqlTests.Retire_ACursorWithNoEarlierEventToStepBackTo_KeepsTheStreamWaitingAsync, RetiredEventTypePurgeStepTests.Purge_ReportsANameNothingIsStoredUnder_OnceAProcess_AndTheWaitingStreamsAsync}

## The receive boundary {#the-receive-boundary}

{verified: MessageDiscardPolicyTests.EvaluateReceive_ARetiredType_IsDiscardedAsRetired_EvenWhenConsumedOrAbsorbedAsync, ReceiveConsumerGateTests.ARetiredType_IsUnconsumed_EvenWhenARegistryStillNamesAConsumerAsync}

A retired type is turned away at receive, whatever would otherwise keep it (a consumer, an
[absorbed namespace](../dispatcher/routing#owned-and-subscribed)), with the discard reason `RetiredType`, logged at
Information on the first sighting of each type. A sender still emitting it has not retired it yet. The same decision
drops a retired child of a redelivery bundle at expansion, and stream integrity compares only what the boundary keeps,
so a retired type is never compared, asked for or stored again.

## Retired types and stream integrity {#retired-types-and-stream-integrity}

{verified: CleanupIntegrityMatrixTests.CleanupAndIntegrity_Converge_AndAGenuineLossBesideTheCleanupIsStillRepairedAsync}

Integrity never reports as missing, or restores, history that was retired on purpose. Each side's purge runs on its own
timing, and a held stream may keep some of the type's history on one side after the other has purged it; neither side
compares the type, so neither notices. The [cleanup-and-integrity matrix](../../resilience/stream-integrity#retired-event-types)
holds every integrity mechanism to that, in both directions. A one-sided retirement halts the pair for the type until
the other side declares it too.

## Why not make the type ephemeral {#why-not-ephemeral}

{verified: CleanupIntegrityMatrixTests.CleanupAndIntegrity_Converge_AndAGenuineLossBesideTheCleanupIsStillRepairedAsync}

A retired type cannot be declared [ephemeral](ephemeral-events#making-an-existing-type-ephemeral) instead, for the
long-lived mixed streams this is for:

- **A stream becomes ephemeral whole.** Reclassifying a type's history refuses a stream that holds an event of a type
  meant to stay durable, so on a mixed stream the retired events would stay durable and be counted forever.
- **There is no class to declare it on.** Ephemeral is declared on the type; a deleted type has none.
- **Ephemeral is a different promise.** An ephemeral event is still delivered and applied, then reaped once consumed; a
  retired event has no reader at all, and its history should simply not be counted.

So a retirement is its own rule: the events go, from mixed streams too, and the digest stops counting the type.

The alternatives considered and rejected:

| Option | Why not |
|---|---|
| A purge on one service only, outside the rules | Peers still count the type, so the purged service looks short and is sent the events again, and the purge removes them again, in a loop. |
| Defer the change | The history of a deleted type keeps growing with nothing to remove it. |

## Options {#options}

| Option | Default | Meaning |
|---|---|---|
| `Whizbang:EventStore:RetiredTypes:Names` | empty | The retired event types, by name, with or without the assembly. |
| `Whizbang:EventStore:RetiredTypes:BatchStreams` | `500` | The most streams one purge batch takes. At least 1. |
| `Whizbang:EventStore:RetiredTypes:MaxBatchesPerCycle` | `10` | The most purge batches one maintenance cycle runs. At least 1. |

See [the configuration reference](../../operations/configuration/configuration-reference#retired-event-types-options).
