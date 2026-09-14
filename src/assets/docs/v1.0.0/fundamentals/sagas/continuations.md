---
title: Saga Continuations
pageType: concept
version: 1.0.0
category: Application Blocks
order: 3
description: >-
  Running one saga after another finishes, so two workloads belonging to the
  same operation stop competing for claim capacity. Why priority cannot express
  this, and why the continuation carries its own claim key.
tags: 'sagas, continuations, chaining, sequencing, priority, claim-capacity'
codeReferences:
  - src/Whizbang.Sagas.Contracts/ContinuesWithAttribute.cs
  - src/Whizbang.Sagas.Contracts/SagaContinuation.cs
  - src/Whizbang.Sagas.Contracts/SagaContinuationTriggers.cs
  - src/Whizbang.Sagas/SagaContinuationRegistry.cs
  - src/Whizbang.Sagas/SagaContinuationRequestedEvent.cs
  - src/Whizbang.Sagas/Helpers/SagaContinuationGuard.cs
  - src/Whizbang.Sagas/Services/BaseSagaService.cs
testReferences:
  - tests/Whizbang.Sagas.Tests/SagaContinuationTests.cs
  - tests/Whizbang.Sagas.Tests/Generators/SagaContinuationGeneratorTests.cs
---

# Saga Continuations

## The problem

Two workloads that belong to the same operation compete for the same claim capacity because nothing
sequences them.

A bulk import produces a large volume of events. A derived pass over the same rows, an enrichment or
an embedding build, gets queued while that import is still running. It reads the rows the import is
still writing, so it competes for claim capacity, for the database, and it reads data whose
perspective worker has not finished indexing. None of that work needed to happen concurrently.

## Why priority cannot fix it

The instinct is to declare the second workload lower than background so it waits. Measured against
the claim, that does not work, for three separate reasons.

**Inside a bucket the number orders nothing.** The claim selects in three lanes by bucket
(interactive 1-99, standard 100-199, background 200 and up) and orders *within* a lane by arrival. A
declaration of 400 and a declaration of 250 both land in the background lane and are then ordered by
`received_at`. A new constant below `BACKGROUND` would change no scheduling decision.

**The background bucket holds a guaranteed floor.** It receives at least a tenth of every batch while
it has pending streams. Follow-on work queued at background priority therefore takes claim capacity
away from the import for as long as both are pending, which is the contention being complained about.

**Background is promoted with age, not demoted.** A background row that has waited past the
background wait target competes in the standard lane. So the longer the import runs, the more urgent
the waiting follow-on becomes. The mechanism does the opposite of waiting.

Priority answers "how urgent is this relative to other work in flight". The requirement here is "this
work must not be in flight yet". Those are different questions, and only the second one removes the
contention.

Once sequenced, the priority question largely answers itself: the follow-on runs when the import is
over, so `BACKGROUND` is both correct and sufficient, and neither the floor nor the age promotion
matters because there is nothing left to compete with.

## Declaring a chain

```csharp{title="Declaring a continuation" description="Enrichment over what the import wrote, which has no reason to run while the import is running." framework="NET10" category="Sagas" difficulty="INTERMEDIATE" tags=["sagas", "continuations", "sequencing", "continues-with"] tests=["SagaContinuationGeneratorTests.ADeclaredChainIsRegisteredAtLoadAsync"]}
[Saga("BulkImport")]
[ContinuesWith("DerivedEnrichment")]
[ContinuesWith("ImportCleanup", SagaContinuationTriggers.Failed)]
public partial class BulkImportSaga;
```

Repeatable: a saga can be followed by several, each with its own trigger.

### Triggers

| Trigger | Starts after | When to use |
|---|---|---|
| `Completed` | Every item succeeded | The follow-on assumes a complete set |
| `CompletedWithFailures` | Ran to the end, some items failed | Rarely alone; usually part of `RanToTheEnd` |
| `Failed` | Abandoned before all items finished | Compensating or cleanup work |
| `RanToTheEnd` | **Default.** `Completed` or `CompletedWithFailures` | Follow-on work over whatever the run produced |

{verified: SagaContinuationTests.TheDefaultTriggerIsRanToTheEndAsync, SagaContinuationTests.AFailureTriggerStartsOnAbortAsync}

The default is "ran to the end" rather than "succeeded outright" because a partially failed import
still produced rows worth enriching, while an abandoned one did not.

A non-terminal status never starts a continuation, whatever the trigger says. `Running` means the
saga is still writing and `Reset` is a transition marker rather than a resting state, so a follow-on
started from either would read a set that is still changing.

```csharp{title="A non-terminal status starts nothing" description="Even a trigger naming every terminal status declines for Running, Pending and Reset." framework="NET10" category="Sagas" difficulty="ADVANCED" tags=["sagas", "continuations", "terminal-status"] tests=["SagaContinuationTests.ANonTerminalStatusNeverStartsAContinuationAsync"]}
var everything = new SagaContinuation(
  "DerivedEnrichment",
  SagaContinuationTriggers.Completed
    | SagaContinuationTriggers.CompletedWithFailures
    | SagaContinuationTriggers.Failed);

everything.StartsAfter(SagaStatus.Running);   // false
everything.StartsAfter(SagaStatus.Reset);     // false
```

## Reacting to the request

The framework **requests** the continuation rather than initiating it. It does not know the follow-on
saga's item set, and a saga's items are consumer domain, so inventing one would be guessing.

Write one receptor on `SagaContinuationRequestedEvent`, filter on the saga name you declared, and
initiate that saga for the parent's `EntityId`.

```csharp{title="Starting the chained saga" description="SagaName is the saga being asked to start, so the receptor filters on the name it declared." framework="NET10" category="Sagas" difficulty="INTERMEDIATE" tags=["sagas", "continuations", "receptor", "initiate"] unverified="consumer-side wiring; the request's own contents are verified by SagaContinuationTests.CompletingAChainedSagaRequestsTheContinuationAsync"}
public class EnrichmentChainReceptor(DerivedEnrichmentSaga.Service saga)
  : IReceptor<SagaContinuationRequestedEvent> {

  public async Task HandleAsync(SagaContinuationRequestedEvent request, CancellationToken ct) {
    if (request.SagaName != DerivedEnrichmentSaga.SagaName) {
      return;
    }

    // The parent wrote the rows; this run's items are whatever still needs enriching for it.
    var items = await _itemsToEnrichAsync(request.EntityId, ct);

    await saga.InitiateSagaAsync(
      new SagaContext(TrackedGuid.NewMedo(), request.EntityId), items, ct);
  }
}
```

`SagaName` on the request is the saga **being asked to start**, not the one that finished, which is
what lets the receptor filter on a name it already knows. The parent is described by
`ParentSagaName`, `ParentSagaId` and `ParentFinalStatus`. `EntityId` is the parent's, because a
continuation acts on the same domain entity.

## Exactly once, and not lost

The request goes through `PublishOnceAsync` under its own claim key,
`saga-continuation:{parent}:{parentSagaId}:{continuation}`.

**Separate from the completion claim, on purpose.** The obvious placement is "publish the continuation
when this caller wins the completion claim", but then a process that dies between winning that claim
and publishing the request loses the chain permanently: the completion claim is already taken, so no
retry and no watchdog tick will drive it again.

Giving the continuation its own key lets every caller that reaches terminal attempt the request,
including the ones that lost the completion claim and including the
[watchdog recovery path](./completion-orchestration.md), while the claim still collapses them to a
single emission.

{verified: SagaContinuationTests.TheContinuationClaimKeyIsItsOwnAsync, SagaContinuationTests.LosingTheCompletionClaimStillRequestsTheContinuationAsync}

The continuation's name is in the key because a saga can be followed by several, and one key across
all of them would start only the first.

A failed request does not fail the completion. The saga did finish, its completion event is the
durable record of that, and propagating a transient publish failure would roll back the caller's
transaction and re-run the terminal path. The watchdog can drive the request again; an undone
completion is worse.

## How the declaration reaches runtime

`SagaContinuationRegistry` holds the chains, written by a generated module initializer so a chain is
known at assembly load without the host calling an `Add` method, and whether or not the saga
generated a service.

Per assembly, because a generator sees only its own compilation: a saga declared in a library is
commonly composed by a host that the library knows nothing about, so the registrations compose as
assemblies load, with no reflection. Keyed by saga name rather than by type, because that is what a
saga event carries on the wire, so a continuation survives a rename of the class behind it.

Registration is idempotent: a library and the host that composes it can both register the same
declaration, and a chain recorded twice would ask for the follow-on twice.

{verified: SagaContinuationTests.SeveralContinuationsAreKeptAndDuplicatesAreNotAsync, SagaContinuationGeneratorTests.AnExplicitTriggerSurvivesGenerationAsync}

## What this does not do

A scheduling class genuinely below background, exempt from the floor and from the age promotion, is
something the claim could express and is not what this is. It would be a new lane, a new partial
index, and a migration. Sequencing removes the need for it in the case that motivated this feature.

## Related

- [Completion Orchestration & Adaptive Watchdog](./completion-orchestration.md) covers how a saga
  reaches the terminal status a continuation triggers on.
- [Message Priority](../messaging/message-priority.md) covers the buckets, the floor and the wait
  target this page measures against.
