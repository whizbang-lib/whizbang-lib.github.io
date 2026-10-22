---
title: Saga Commit and Rollback
pageType: concept
version: 1.0.0
category: Application Blocks
order: 4
description: >-
  A saga that opts in is committed or rolled back exactly once, whichever way it
  ends: completion, failure, abandonment or an explicit cancel. The framework
  signals the outcome; consumers stage their effects, apply them on commit and
  discard or compensate on rollback.
tags: 'sagas, commit, rollback, compensation, transactional, staging, cancel'
codeReferences:
  - src/Whizbang.Sagas.Contracts/SignalsOutcomeAttribute.cs
  - src/Whizbang.Sagas.Contracts/SagaOutcome.cs
  - src/Whizbang.Sagas.Contracts/SagaOutcomePolicy.cs
  - src/Whizbang.Sagas.Contracts/Events/ISagaOutcomeEvent.cs
  - src/Whizbang.Sagas.Contracts/Events/ISagaCommittedEvent.cs
  - src/Whizbang.Sagas.Contracts/Events/ISagaRolledBackEvent.cs
  - src/Whizbang.Sagas/SagaCommittedEvent.cs
  - src/Whizbang.Sagas/SagaRolledBackEvent.cs
  - src/Whizbang.Sagas/SagaOutcomeRegistry.cs
  - src/Whizbang.Sagas/Helpers/SagaOutcomeGuard.cs
  - src/Whizbang.Sagas/Services/BaseSagaService.cs
testReferences:
  - tests/Whizbang.Sagas.Tests/SagaOutcomeTests.cs
  - tests/Whizbang.Sagas.Tests/Generators/SagaOutcomeGeneratorTests.cs
---

# Saga Commit and Rollback

## The problem

A saga that runs a chain of steps can fail partway and leave its earlier steps' effects in place.

An early step switches which version of some configuration is active. A later step fails, perhaps
because an item it needed is missing. The saga ends `Failed`, and the switch is still applied. The
framework knows the run failed, but nothing tells anyone to undo the switch. A cancel that stops new
items from dispatching undoes nothing either.

## What a saga gets

A saga that declares `[SignalsOutcome]` gets exactly one terminal **outcome** per run: commit or
rollback. The framework publishes it once, whichever way the run ends:

- through the per-item fast path;
- through the watchdog's recovery path;
- through an explicit `CompleteSagaAsync(..., SagaStatus.Failed, ...)` (fail-fast);
- through the watchdog's abandonment;
- through an explicit `RollbackSagaAsync`, which is what a cancel calls.

The framework **signals**; it does not compensate. Compensation order is domain-specific. Refunding a
payment comes before un-archiving an order in one workflow and after it in another. So what a commit
applies and what a rollback undoes belong to your receptors. What the framework adds is a single,
durable, exactly-once source for the decision.

## Declaring it

```csharp{title="Opting a saga in" description="One attribute; the generator registers the saga's outcome policy at assembly load." framework="NET10" category="Sagas" difficulty="INTERMEDIATE" tags=["sagas", "commit", "rollback", "attribute"]}
[Saga("ConfigurationRollout")]
[SignalsOutcome]
public partial class ConfigurationRolloutSaga;

// A saga that tolerates some failed items, and keeps what the rest did.
[Saga("ReportRefresh")]
[SignalsOutcome(OnCompletedWithFailures = SagaOutcome.Commit)]
public partial class ReportRefreshSaga;
```

{verified: SagaOutcomeGeneratorTests.ADeclaredSagaIsRegisteredAtLoadAsync, SagaOutcomeGeneratorTests.AnExplicitPolicySurvivesGenerationAsync}

The generator writes the registration into a module initializer, the same way it registers
[continuations](./continuations). The saga is registered when its assembly loads, whether or not
the generator produced a service (`GenerateService = false`), and the host calls no `Add` method. A
saga that does not declare it completes exactly as before. It gets no extra event and no extra claim.

## Which status commits

| The run ended | Outcome |
|---|---|
| `Completed` | Commit |
| `CompletedWithFailures` | Rollback, unless the saga declares `OnCompletedWithFailures = SagaOutcome.Commit` |
| `Failed` | Rollback |
| `Abandoned` | Rollback |
| `RollbackSagaAsync` was called | Rollback |

{verified: SagaOutcomeTests.EveryTerminalStatusHasAnOutcomeAsync, SagaOutcomeTests.CompletedWithFailuresRollsBackByDefaultAsync, SagaOutcomeTests.ASagaCanCommitAPartlyFailedRunAsync}

A partly failed run rolls back by default. A saga that opted in is one whose steps must not outlive a
failed run, so a partial failure counts as a failure. A saga that tolerates gaps says so with
`OnCompletedWithFailures = SagaOutcome.Commit`. That policy covers only failed items. A run that
stopped partway (`Failed`, `Abandoned`) always rolls back, because nothing is left to finish it.

A status that is not terminal (`Pending`, `Running`, `Reset`) has no outcome.

## Reacting to it

The two signals are concrete framework events, `SagaCommittedEvent` and `SagaRolledBackEvent`. They
are stored on the run's own stream and carry `SagaName`, `EntityId`, `StreamId` (the run),
`FinalStatus` and `Reason`. Write one receptor on each, and filter on your saga's name.

```csharp{title="Committing and rolling back a configuration rollout" description="The commit receptor applies what the steps staged; the rollback receptor discards it." framework="NET10" category="Sagas" difficulty="ADVANCED" tags=["sagas", "commit", "rollback", "receptor", "staging"] unverified="consumer-side receptors; the signals' contents are verified by SagaOutcomeTests"}
public class RolloutCommitReceptor(IConfigurationVersions versions)
  : IReceptor<SagaCommittedEvent> {

  public async Task HandleAsync(SagaCommittedEvent committed, CancellationToken ct) {
    if (committed.SagaName != ConfigurationRolloutSaga.SagaName) {
      return;
    }
    // The steps staged the new version as inactive; committing activates it.
    await versions.ActivateStagedAsync(stagedBy: committed.StreamId, ct);
  }
}

public class RolloutRollbackReceptor(IConfigurationVersions versions)
  : IReceptor<SagaRolledBackEvent> {

  public async Task HandleAsync(SagaRolledBackEvent rolledBack, CancellationToken ct) {
    if (rolledBack.SagaName != ConfigurationRolloutSaga.SagaName) {
      return;
    }
    // Nothing was activated, so rolling back is deleting the staging.
    await versions.DiscardStagedAsync(stagedBy: rolledBack.StreamId, ct);
  }
}
```

`FinalStatus` is the status the run ended in. It is `null` for an explicit rollback, which can arrive
before the run has a status at all. `Reason` is the caller's reason for an explicit rollback, and
otherwise a short account of the status, so the compensator can log why it is undoing work without
reading the projection.

Both receptors must be idempotent, as every receptor is. The framework publishes one signal per run,
but delivery is at-least-once.

## Stage, then apply

The signal makes a saga behave transactionally across services. The step design is what makes the
rollback cheap. Steps should **stage** their effects rather than apply them:

1. A step **stages**. It writes the new configuration version as inactive, reserves stock instead of
   decrementing it, or writes rows to a pending table keyed by the run's stream id.
2. The **commit** receptor **applies** what was staged. It activates the version, captures the
   reservation, or promotes the pending rows.
3. The **rollback** receptor **discards** what was staged. It also **compensates** for anything a step
   could not stage and had to apply directly.

A step that stages has nothing to undo on rollback beyond deleting its staging. Compensating for an
applied effect is the hard, domain-specific case: reversing a charge, restoring a deleted row, telling
a downstream system to forget something. Staging removes most of it, which is why the shape is
encouraged. Compensation events can still be marked with `ISagaCompensatingEvent`, so audit and
visualization tooling groups them apart from forward-path work.

Until the commit arrives, a read that must not see staged work filters it out, by the staging flag or
by the run's recorded [outcome](#recording-it-on-the-projection).

## Rolling back explicitly

A cancel calls `RollbackSagaAsync` with a reason:

```csharp{title="Cancelling a run" description="Signals rollback now, under the run's one outcome claim." framework="NET10" category="Sagas" difficulty="INTERMEDIATE" tags=["sagas", "rollback", "cancel"]}
var rolledBack = await saga.RollbackSagaAsync(ctx, "canceled by an operator", ct);
// false: the run already had an outcome, committed or rolled back.
```

{verified: SagaOutcomeTests.AnExplicitRollbackSignalsRollbackWithTheReasonAsync, SagaOutcomeTests.ASecondRollbackIsNotSignaledAgainAsync}

It is honored for a saga that did not declare `[SignalsOutcome]`. The declaration decides whether
completion signals on its own, and a caller that asks for a rollback by name has already decided. A
blank reason is refused, because a rollback nobody can explain is one nobody can audit.

It signals; it does not stop the run. Stopping new items from dispatching is still the caller's job.
Once the rollback is signaled, though, nothing that happens later can commit the run.

## Exactly one outcome

The signal goes through `PublishOnceAsync` under one claim key per run,
`saga-outcome:{sagaName}:{sagaId}`, **shared by both outcomes**. A run gets one outcome and never both,
whichever path asks first. A rollback taken by a cancel is not overturned by a completion that was
already in flight, and a commit is not overturned by a later abandonment.

{verified: SagaOutcomeTests.TheOutcomeClaimKeyIsItsOwnAndSharedByBothOutcomesAsync, SagaOutcomeTests.ARolledBackRunIsNeverCommittedAsync}

The key is separate from the completion claim, for the reason a continuation's is. Every caller that
reaches terminal attempts the signal, including the ones that lost the completion claim, and the claim
collapses them to one emission. If only the completion winner signaled, a process that died between
the two publishes would leave the run with no outcome, and its earlier steps would never be undone.

{verified: SagaOutcomeTests.LosingTheCompletionClaimStillSignalsTheOutcomeAsync, SagaOutcomeTests.ARetriedAbandonmentStillRollsBackAsync}

### When the publish fails

- **At completion**, a failed signal does not fail the completion. The run did finish and its
  completion event records it. Propagating would roll back the caller's transaction and re-run the
  terminal path. Instead, the next watchdog tick finds the run complete and signals again, using the
  status the projection recorded. If the signal did land, the retry costs nothing, because the claim is
  already taken.
- **At abandonment**, a failed signal propagates. The abandoning tick is the last in its chain, so no
  later tick exists to retry the rollback. Failing the tick gets it redelivered.

{verified: SagaOutcomeTests.AFailedSignalDoesNotFailTheCompletionAsync, SagaOutcomeTests.AWatchdogTickOnACompletedRunRetriesTheSignalAsync, SagaOutcomeTests.AFailedRollbackAtAbandonmentPropagatesAsync}

The retry depends on a watchdog tick reaching the completed run, and on the saga's service overriding
`LoadProjectionAsync` so the tick can read the recorded status. That is the same wiring the
watchdog's recovery path already needs.

## Recording it on the projection

`BaseSagaModel.Outcome` holds the run's outcome once a perspective applies the signal:

```csharp{title="Applying the outcome" description="The first outcome stands; a replayed or duplicated signal records nothing." framework="NET10" category="Sagas" difficulty="INTERMEDIATE" tags=["sagas", "perspective", "apply", "outcome"]}
public ConfigurationRolloutModel Apply(ConfigurationRolloutModel model, SagaRolledBackEvent rolledBack) {
  SagaApplyHelper.TrackOutcome(model, rolledBack.Outcome, rolledBack.OccurredAt);
  return model;
}
```

{verified: SagaOutcomeTests.TheProjectionRecordsTheFirstOutcomeAsync}

Recording it is optional. The one-outcome guarantee comes from the claim, not from this field. The
field lets a dashboard show a run as rolled back rather than merely failed, and lets a read check
whether the run that staged something was committed.

## What this does not do

- **Run compensation for you.** It is the reason `ISagaCompensatingEvent` gave for not shipping an
  engine, and it still holds.
- **Opt every saga in.** An extra event and claim per run would cost every saga that never asked.
- **Stop a canceled run.** `RollbackSagaAsync` signals; dispatch is still the caller's.

## Related

- [Whizbang.Sagas](./whizbang-sagas) covers the lifecycle the outcome is decided from.
- [Completion Orchestration & Adaptive Watchdog](./completion-orchestration) covers the watchdog's
  recovery and abandonment paths, which both signal.
- [Saga Continuations](./continuations) uses the same separate-claim design to start a follow-on
  saga.
